import {
  FastifyPluginAsync
} from "fastify";

import {
  syncTrackersFromTracking3D,
  createTrackerAndReplicate,
  updateTrackerAndReplicate,
  deleteTrackerAndReplicate,
  TrackerValidationError,
  TrackerDuplicateError
} from "../services/tracker-sync.service";

import {
  logAction,
  getActorFromRequest
} from "../services/audit-log.service";

interface TrackersListQuery {
  page?: string;
  limit?: string;
  search?: string;
  active?: string;
}

interface TrackerUidParams {
  uid: string;
}

interface TrackerIdParams {
  id: string;
}

interface CreateTrackerBody {
  imei?: string;
  unitModelName?: string;
}

interface UpdateTrackerBody {
  name?: string;
  imei?: string;
  simUid?: string;
}

const trackerRoutes:
  FastifyPluginAsync =
  async (app) => {

    /**
     * Listar trackers locales (con búsqueda).
     *
     * Este endpoint solo lee la tabla local: POST /trackers/sync hace
     * una carga inicial completa desde 3Dtracking, y POST /trackers
     * agrega altas nuevas (local + 3Dtracking) sin necesidad de
     * repetir ese sync.
     *
     * GET
     * /api/v1/tracking/trackers/local
     *
     * Parámetros:
     * ?page=1
     * ?limit=20
     * ?search=ABC  (busca en uid, name, imei, trackerTypeName, unitModelName)
     * ?active=false
     */
    app.get<{
      Querystring: TrackersListQuery;
    }>(
      "/trackers/local",
      {
        preHandler: async (request) => {

          await request.jwtVerify();

        }
      },
      async (request, reply) => {

        try {

          const page = Math.max(
            parseInt(request.query.page || "1", 10),
            1
          );

          const limit = Math.min(
            Math.max(
              parseInt(request.query.limit || "20", 10),
              1
            ),
            100
          );

          const skip = (page - 1) * limit;

          const where: {
            active: boolean;
            OR?: Array<{
              uid?: { contains: string };
              name?: { contains: string };
              imei?: { contains: string };
              trackerTypeName?: { contains: string };
              unitModelName?: { contains: string };
            }>;
          } = {
            active:
              request.query.active === "false"
                ? false
                : true
          };

          if (request.query.search) {
            const search = request.query.search.trim();

            if (search) {
              where.OR = [
                { uid: { contains: search } },
                { name: { contains: search } },
                { imei: { contains: search } },
                { trackerTypeName: { contains: search } },
                { unitModelName: { contains: search } }
              ];
            }
          }

          const [trackers, total] =
            await Promise.all([
              app.prisma.tracker.findMany({
                where,
                skip,
                take: limit,
                orderBy: { id: "asc" }
              }),

              app.prisma.tracker.count({
                where
              })
            ]);

          return reply.send({

            success: true,

            data: trackers,

            pagination: {
              page,
              limit,
              total,
              pages: Math.ceil(total / limit)
            }

          });

        } catch (error) {

          app.log.error(error);

          return reply
            .code(500)
            .send({

              success: false,

              error:
                "INTERNAL_SERVER_ERROR",

              message:
                "Error obteniendo trackers"

            });

        }

      }
    );

    /**
     * Crear un tracker
     *
     * Solo recibe imei y unitModelName: name se fija automáticamente
     * igual al imei, y trackerTypeUid/unitModelUid se resuelven
     * buscando unitModelName en la tabla local UnitModel (ver
     * routes/unitmodels.ts) — 400 UNIT_MODEL_NOT_FOUND si no está en
     * el catálogo. Antes de escribir nada, valida (local + consulta
     * en vivo a 3Dtracking) que el IMEI no esté ya en uso. Si pasa la
     * validación, se guarda en la base local y luego se replica en
     * 3Dtracking (devices/tracker/create). Si la replicación falla,
     * el tracker queda creado localmente con syncStatus "error" (ver
     * campo tracking3d en la respuesta). Registra en el log de
     * auditoría quién lo ejecutó.
     *
     * POST
     * /api/v1/tracking/trackers
     */
    app.post<{
      Body: CreateTrackerBody;
    }>(
      "/trackers",
      {
        preHandler: async (request) => {

          await request.jwtVerify();

        }
      },
      async (request, reply) => {

        const imei = request.body?.imei?.trim();
        const unitModelName = request.body?.unitModelName?.trim();

        if (!imei) {

          return reply
            .code(400)
            .send({

              success: false,

              error:
                "INVALID_BODY",

              message:
                "El campo imei es requerido"

            });

        }

        if (!unitModelName) {

          return reply
            .code(400)
            .send({

              success: false,

              error:
                "INVALID_BODY",

              message:
                "El campo unitModelName es requerido"

            });

        }

        const actor = getActorFromRequest(request);

        try {

          const unitModel =
            await app.prisma.unitModel.findUnique({
              where: { name: unitModelName }
            });

          if (!unitModel || !unitModel.trackerTypeUid) {

            await logAction(app.prisma, {
              ...actor,
              module: "trackers",
              action: "create",
              resource: imei,
              success: false,
              message: `unitModelName "${unitModelName}" no encontrado en el catálogo local (o sin trackerType asociado)`,
              requestBody: request.body
            });

            return reply
              .code(400)
              .send({

                success: false,

                error:
                  "UNIT_MODEL_NOT_FOUND",

                message:
                  `No se encontró "${unitModelName}" en el catálogo de modelos (GET /api/v1/tracking/unitmodels/local). Sincroniza el catálogo (POST /unitmodels/sync) o revisa el nombre.`

              });

          }

          const { tracker, replication } =
            await createTrackerAndReplicate(
              app.prisma,
              app.tracking3d,
              {
                imei,
                name: imei,
                trackerTypeUid: unitModel.trackerTypeUid,
                unitModelUid: unitModel.uid
              }
            );

          await logAction(app.prisma, {
            ...actor,
            module: "trackers",
            action: "create",
            resource: imei,
            success: true,
            message: replication.synced
              ? undefined
              : `Creado local; falló replicación en 3Dtracking: ${replication.message}`,
            requestBody: request.body,
            afterState: tracker
          });

          return reply
            .code(201)
            .send({

              success: true,

              data: tracker,

              tracking3d: replication

            });

        } catch (error: any) {

          if (error instanceof TrackerDuplicateError) {

            await logAction(app.prisma, {
              ...actor,
              module: "trackers",
              action: "create",
              resource: imei,
              success: false,
              message: error.message,
              requestBody: request.body
            });

            return reply
              .code(409)
              .send({

                success: false,

                error:
                  "TRACKER_ALREADY_EXISTS",

                source: error.source,

                message: error.message

              });

          }

          if (error instanceof TrackerValidationError || error?.code === "P2002") {

            await logAction(app.prisma, {
              ...actor,
              module: "trackers",
              action: "create",
              resource: imei,
              success: false,
              message: error.message,
              requestBody: request.body
            });

            return reply
              .code(error?.code === "P2002" ? 409 : 400)
              .send({

                success: false,

                error:
                  error?.code === "P2002" ? "TRACKER_ALREADY_EXISTS" : "INVALID_BODY",

                message: error.message

              });

          }

          app.log.error(error);

          await logAction(app.prisma, {
            ...actor,
            module: "trackers",
            action: "create",
            resource: imei,
            success: false,
            message: error instanceof Error ? error.message : "Error desconocido",
            requestBody: request.body
          });

          return reply
            .code(500)
            .send({

              success: false,

              error:
                "INTERNAL_SERVER_ERROR",

              message:
                "Error creando el tracker"

            });

        }

      }
    );

    /**
     * Actualizar un tracker
     *
     * :id acepta uid o imei. Si se envía un imei nuevo, valida (local
     * + consulta en vivo a 3Dtracking, excluyendo al propio tracker)
     * que no esté ya en uso. Actualiza name/imei/simUid en la base
     * local — no trackerTypeUid/unitModelUid: 3Dtracking no los
     * admite en este endpoint. Si el tracker ya tiene uid (fue creado
     * en 3Dtracking), replica el cambio con
     * devices/tracker/{Uid}/update. Registra en el log de auditoría
     * quién lo ejecutó.
     *
     * PATCH
     * /api/v1/tracking/trackers/:id
     */
    app.patch<{
      Params: TrackerIdParams;
      Body: UpdateTrackerBody;
    }>(
      "/trackers/:id",
      {
        preHandler: async (request) => {

          await request.jwtVerify();

        }
      },
      async (request, reply) => {

        const identifier = request.params.id.trim();

        if (!identifier) {

          return reply
            .code(400)
            .send({

              success: false,

              error:
                "INVALID_IDENTIFIER",

              message:
                "El identificador del tracker no es válido"

            });

        }

        const actor = getActorFromRequest(request);

        try {

          const result =
            await updateTrackerAndReplicate(
              app.prisma,
              app.tracking3d,
              identifier,
              request.body || {}
            );

          if (!result) {

            return reply
              .code(404)
              .send({

                success: false,

                error:
                  "TRACKER_NOT_FOUND",

                message:
                  "Tracker no encontrado"

              });

          }

          await logAction(app.prisma, {
            ...actor,
            module: "trackers",
            action: "update",
            resource: identifier,
            success: true,
            message: result.replication.synced
              ? undefined
              : `Actualizado local; falló replicación en 3Dtracking: ${result.replication.message}`,
            requestBody: request.body,
            beforeState: result.before,
            afterState: result.tracker
          });

          return reply.send({

            success: true,

            data: result.tracker,

            tracking3d: result.replication

          });

        } catch (error: any) {

          if (error instanceof TrackerDuplicateError) {

            await logAction(app.prisma, {
              ...actor,
              module: "trackers",
              action: "update",
              resource: identifier,
              success: false,
              message: error.message,
              requestBody: request.body
            });

            return reply
              .code(409)
              .send({

                success: false,

                error:
                  "TRACKER_ALREADY_EXISTS",

                source: error.source,

                message: error.message

              });

          }

          if (error instanceof TrackerValidationError) {

            await logAction(app.prisma, {
              ...actor,
              module: "trackers",
              action: "update",
              resource: identifier,
              success: false,
              message: error.message,
              requestBody: request.body
            });

            return reply
              .code(400)
              .send({

                success: false,

                error:
                  "INVALID_BODY",

                message: error.message

              });

          }

          app.log.error(error);

          await logAction(app.prisma, {
            ...actor,
            module: "trackers",
            action: "update",
            resource: identifier,
            success: false,
            message: error instanceof Error ? error.message : "Error desconocido",
            requestBody: request.body
          });

          return reply
            .code(500)
            .send({

              success: false,

              error:
                "INTERNAL_SERVER_ERROR",

              message:
                "Error actualizando el tracker"

            });

        }

      }
    );

    /**
     * Eliminar un tracker (borrado lógico)
     *
     * Marca el tracker como inactivo (active: false) en la base
     * local y, si ya tenía uid (fue creado en 3Dtracking), lo
     * elimina allá con devices/tracker/{Uid}/delete. :id acepta uid
     * o imei. Registra en el log de auditoría quién lo ejecutó.
     *
     * DELETE
     * /api/v1/tracking/trackers/:id
     */
    app.delete<{
      Params: TrackerIdParams;
    }>(
      "/trackers/:id",
      {
        preHandler: async (request) => {

          await request.jwtVerify();

        }
      },
      async (request, reply) => {

        const identifier = request.params.id.trim();

        if (!identifier) {

          return reply
            .code(400)
            .send({

              success: false,

              error:
                "INVALID_IDENTIFIER",

              message:
                "El identificador del tracker no es válido"

            });

        }

        const actor = getActorFromRequest(request);

        try {

          const result =
            await deleteTrackerAndReplicate(
              app.prisma,
              app.tracking3d,
              identifier
            );

          if (!result) {

            return reply
              .code(404)
              .send({

                success: false,

                error:
                  "TRACKER_NOT_FOUND",

                message:
                  "Tracker no encontrado"

              });

          }

          await logAction(app.prisma, {
            ...actor,
            module: "trackers",
            action: "delete",
            resource: identifier,
            success: true,
            message: result.replication.synced
              ? undefined
              : `Borrado local; no replicado en 3Dtracking: ${result.replication.message}`,
            beforeState: result.before,
            afterState: result.tracker
          });

          return reply.send({

            success: true,

            data: result.tracker,

            tracking3d: result.replication

          });

        } catch (error) {

          app.log.error(error);

          await logAction(app.prisma, {
            ...actor,
            module: "trackers",
            action: "delete",
            resource: identifier,
            success: false,
            message: error instanceof Error ? error.message : "Error desconocido"
          });

          return reply
            .code(500)
            .send({

              success: false,

              error:
                "INTERNAL_SERVER_ERROR",

              message:
                "Error eliminando el tracker"

            });

        }

      }
    );

    /**
     * Forzar una sincronización completa de trackers desde
     * 3Dtracking. Pensado como carga inicial única; las altas nuevas
     * deberían entrar por POST /trackers (arriba), no repitiendo este
     * sync completo.
     *
     * POST
     * /api/v1/tracking/trackers/sync
     */
    app.post(
      "/trackers/sync",
      {
        preHandler: async (request) => {

          await request.jwtVerify();

        }
      },
      async (request, reply) => {

        try {

          const result =
            await syncTrackersFromTracking3D(
              app.prisma,
              app.tracking3d
            );

          return reply.send({

            success: true,

            data: result

          });

        } catch (error) {

          app.log.error(error);

          return reply
            .code(502)
            .send({

              success: false,

              error:
                "TRACKING3D_SYNC_ERROR",

              message:
                "No se pudo sincronizar trackers con 3Dtracking"

            });

        }

      }
    );

    /**
     * Buscar un GPS/tracker en vivo por su Uid (consulta directa a
     * 3Dtracking, no la tabla local), con su detalle completo:
     * asignaciones a unidades, asignaciones de SIM e histórico de
     * atributos.
     *
     * GET
     * /api/v1/tracking/trackers/:uid
     */
    app.get<{
      Params: TrackerUidParams;
    }>(
      "/trackers/:uid",
      {
        preHandler: async (request) => {

          await request.jwtVerify();

        }
      },
      async (request, reply) => {

        const uid = request.params.uid.trim();

        if (!uid) {

          return reply
            .code(400)
            .send({

              success: false,

              error:
                "INVALID_IDENTIFIER",

              message:
                "El uid del tracker no es válido"

            });

        }

        try {

          const session =
            await app.tracking3d.authenticate();

          const tracker =
            await app.tracking3d.getTrackerDetail(session, uid);

          if (!tracker) {

            return reply
              .code(404)
              .send({

                success: false,

                error:
                  "TRACKER_NOT_FOUND",

                message:
                  "No existe un tracker con ese uid en 3Dtracking"

              });

          }

          return reply.send({

            success: true,

            data: tracker

          });

        } catch (error) {

          app.log.error(error);

          return reply
            .code(502)
            .send({

              success: false,

              error:
                "TRACKING3D_ERROR",

              message:
                "No se pudo obtener el tracker desde 3Dtracking"

            });

        }

      }
    );

  };

export default trackerRoutes;
