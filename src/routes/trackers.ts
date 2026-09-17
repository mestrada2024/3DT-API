import {
  FastifyPluginAsync
} from "fastify";

import {
  syncTrackersFromTracking3D,
  createTrackerAndReplicate,
  updateTrackerAndReplicate,
  deleteTrackerAndReplicate,
  assignSimToTracker,
  deallocateSimFromTracker,
  TrackerValidationError,
  TrackerDuplicateError
} from "../services/tracker-sync.service";

import {
  applyConfigTemplateToTracker,
  captureConfigTemplateFromTracker,
  copyTrackerConfig,
  TrackerConfigSourceError
} from "../services/tracker-config-template.service";

import {
  logAction,
  getActorFromRequest
} from "../services/audit-log.service";

import { parseSort } from "../utils/sort";

import {
  getAllowedCompanyUids,
  getAllowedTrackerUids,
  requireWrite
} from "../services/access-control.service";

const TRACKER_SORTABLE_FIELDS = [
  "name",
  "uid",
  "imei",
  "unitModelName",
  "trackerTypeName",
  "syncStatus",
  "createdAt"
] as const;

interface TrackersListQuery {
  page?: string;
  limit?: string;
  search?: string;
  active?: string;
  sortBy?: string;
  sortDir?: string;
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

interface AssignSimBody {
  iccid?: string;
  simUid?: string;
}

interface CopyConfigBody {
  targetUid?: string;
  targetImei?: string;
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
     * ?active=false (vestigial: DELETE ahora borra la fila de verdad)
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
            uid?: { in: string[] };
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

          /**
           * root ve todos los trackers; admin/user solo los asignados
           * a una unidad de sus empresas (UserCompany) — trackers sin
           * unidad asignada quedan fuera de su alcance.
           */
          const allowedCompanyUids = await getAllowedCompanyUids(
            app.prisma,
            request.user.sub,
            request.user.role
          );

          if (allowedCompanyUids !== null) {
            where.uid = {
              in: await getAllowedTrackerUids(app.prisma, allowedCompanyUids)
            };
          }

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

          const { field: sortField, direction: sortDirection } = parseSort(
            request.query.sortBy,
            request.query.sortDir,
            TRACKER_SORTABLE_FIELDS,
            "name"
          );

          const [trackers, total] =
            await Promise.all([
              app.prisma.tracker.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [sortField]: sortDirection }
              }),

              app.prisma.tracker.count({
                where
              })
            ]);

          /**
           * Tracker.simUid guarda el Sim.externalId (no el teléfono) —
           * se busca el teléfono de los SIMs referenciados en esta
           * página para no obligar al frontend a resolverlo con N
           * llamados aparte.
           */
          const simExternalIds = [...new Set(
            trackers
              .map((tracker) => tracker.simUid)
              .filter((uid): uid is string => Boolean(uid))
          )];

          const sims = simExternalIds.length
            ? await app.prisma.sim.findMany({
                where: { externalId: { in: simExternalIds } },
                select: { externalId: true, phoneNumber: true, iccid: true }
              })
            : [];

          const simByExternalId = new Map(
            sims.map((sim) => [sim.externalId, sim])
          );

          const trackersWithSimPhone = trackers.map((tracker) => {
            const sim = tracker.simUid ? simByExternalId.get(tracker.simUid) : undefined;

            return {
              ...tracker,
              simPhoneNumber: sim?.phoneNumber || null,
              simIccid: sim?.iccid || null
            };
          });

          return reply.send({

            success: true,

            data: trackersWithSimPhone,

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
        preHandler: async (request, reply) => {

          await request.jwtVerify();
          await requireWrite(request, reply);

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

          const configTemplate =
            replication.synced && tracker.uid
              ? await applyConfigTemplateToTracker(
                  app.prisma,
                  app.tracking3d,
                  tracker.uid,
                  tracker.unitModelUid
                )
              : {
                  applied: false,
                  appliedAttributes: [],
                  skippedAttributes: [],
                  message: replication.synced
                    ? undefined
                    : "No se intentó: el tracker no se replicó en 3Dtracking"
                };

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
            afterState: { ...tracker, configTemplate }
          });

          return reply
            .code(201)
            .send({

              success: true,

              data: tracker,

              tracking3d: replication,

              configTemplate

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
     * Re-aplicar la plantilla de configuración de un tracker
     *
     * Busca la plantilla del unitModel del tracker (:id acepta uid o
     * imei) y aplica sus atributos con valor definido, igual que se
     * hace automáticamente al crear (POST /trackers). Útil para
     * trackers creados antes de que existiera una plantilla, o para
     * reintentar tras editarla.
     *
     * POST
     * /api/v1/tracking/trackers/:id/apply-config
     */
    app.post<{
      Params: TrackerIdParams;
    }>(
      "/trackers/:id/apply-config",
      {
        preHandler: async (request, reply) => {

          await request.jwtVerify();
          await requireWrite(request, reply);

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

          const tracker =
            await app.prisma.tracker.findFirst({
              where: {
                active: true,
                OR: [
                  { uid: identifier },
                  { imei: identifier }
                ]
              }
            });

          if (!tracker) {

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

          if (!tracker.uid) {

            return reply
              .code(400)
              .send({

                success: false,

                error:
                  "INVALID_BODY",

                message:
                  "El tracker no tiene uid (aún no se ha creado en 3Dtracking)"

              });

          }

          const result =
            await applyConfigTemplateToTracker(
              app.prisma,
              app.tracking3d,
              tracker.uid,
              tracker.unitModelUid
            );

          await logAction(app.prisma, {
            ...actor,
            module: "trackers",
            action: "apply-config",
            resource: identifier,
            success: result.applied,
            message: result.message,
            afterState: result
          });

          return reply.send({

            success: true,

            data: result

          });

        } catch (error) {

          app.log.error(error);

          await logAction(app.prisma, {
            ...actor,
            module: "trackers",
            action: "apply-config",
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
                "Error aplicando la plantilla de configuración"

            });

        }

      }
    );

    /**
     * Capturar la plantilla de configuración desde un tracker real
     *
     * Simula "Copiar configuración de la Unidad" (panel de
     * 3Dtracking): lee los atributos configurables ya establecidos en
     * este tracker (:id acepta uid o imei) y los guarda como la
     * plantilla del modelo de ese tracker — de ahí en adelante,
     * POST /trackers los aplica automáticamente a los trackers nuevos
     * de ese mismo modelo.
     *
     * POST
     * /api/v1/tracking/trackers/:id/capture-config-template
     */
    app.post<{
      Params: TrackerIdParams;
    }>(
      "/trackers/:id/capture-config-template",
      {
        preHandler: async (request, reply) => {

          await request.jwtVerify();
          await requireWrite(request, reply);

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
            await captureConfigTemplateFromTracker(
              app.prisma,
              app.tracking3d,
              identifier
            );

          await logAction(app.prisma, {
            ...actor,
            module: "trackers",
            action: "capture-config-template",
            resource: identifier,
            success: true,
            afterState: result
          });

          return reply.send({

            success: true,

            data: result.template,

            sourceTrackerUid: result.sourceTrackerUid,

            capturedAttributes: result.capturedAttributes

          });

        } catch (error) {

          if (error instanceof TrackerConfigSourceError) {

            await logAction(app.prisma, {
              ...actor,
              module: "trackers",
              action: "capture-config-template",
              resource: identifier,
              success: false,
              message: error.message
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
            action: "capture-config-template",
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
                "Error capturando la configuración"

            });

        }

      }
    );

    /**
     * Copiar configuración directo entre dos trackers
     *
     * Simula "Copiar configuración de la Unidad" tracker a tracker,
     * sin pasar por la plantilla: lee los atributos configurables del
     * tracker de origen (:id, acepta uid o imei) y los aplica tal
     * cual al tracker destino (targetUid o targetImei en el body).
     *
     * POST
     * /api/v1/tracking/trackers/:id/copy-config
     */
    app.post<{
      Params: TrackerIdParams;
      Body: CopyConfigBody;
    }>(
      "/trackers/:id/copy-config",
      {
        preHandler: async (request, reply) => {

          await request.jwtVerify();
          await requireWrite(request, reply);

        }
      },
      async (request, reply) => {

        const identifier = request.params.id.trim();
        const targetIdentifier = (request.body?.targetUid || request.body?.targetImei || "").trim();

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

        if (!targetIdentifier) {

          return reply
            .code(400)
            .send({

              success: false,

              error:
                "INVALID_BODY",

              message:
                "Se requiere targetUid o targetImei"

            });

        }

        const actor = getActorFromRequest(request);

        try {

          const result =
            await copyTrackerConfig(
              app.prisma,
              app.tracking3d,
              identifier,
              targetIdentifier
            );

          await logAction(app.prisma, {
            ...actor,
            module: "trackers",
            action: "copy-config",
            resource: `${identifier} -> ${targetIdentifier}`,
            success: result.result.applied,
            message: result.result.message,
            requestBody: request.body,
            afterState: result
          });

          return reply.send({

            success: true,

            data: result

          });

        } catch (error) {

          if (error instanceof TrackerConfigSourceError) {

            await logAction(app.prisma, {
              ...actor,
              module: "trackers",
              action: "copy-config",
              resource: `${identifier} -> ${targetIdentifier}`,
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
            action: "copy-config",
            resource: `${identifier} -> ${targetIdentifier}`,
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
                "Error copiando la configuración"

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
        preHandler: async (request, reply) => {

          await request.jwtVerify();
          await requireWrite(request, reply);

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
     * Asignar (o cambiar) el SIM de un tracker
     *
     * El SIM se identifica por iccid o externalId (simUid) en el
     * body, y debe ya tener externalId (haberse creado en
     * 3Dtracking). Actualiza local siempre primero — Tracker.simUid
     * y, de forma bidireccional, Sim.trackerUid — y, si el tracker ya
     * tiene uid, replica el cambio con devices/tracker/{Uid}/update
     * (el mecanismo real de 3Dtracking para asignar/cambiar SIM; no
     * hay un endpoint "allocate" separado). Registra en el log de
     * auditoría.
     *
     * POST
     * /api/v1/tracking/trackers/:id/sim
     */
    app.post<{
      Params: TrackerIdParams;
      Body: AssignSimBody;
    }>(
      "/trackers/:id/sim",
      {
        preHandler: async (request, reply) => {

          await request.jwtVerify();
          await requireWrite(request, reply);

        }
      },
      async (request, reply) => {

        const identifier = request.params.id.trim();
        const simIdentifier = (request.body?.iccid || request.body?.simUid || "").trim();

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

        if (!simIdentifier) {

          return reply
            .code(400)
            .send({

              success: false,

              error:
                "INVALID_BODY",

              message:
                "Se requiere iccid o simUid"

            });

        }

        const actor = getActorFromRequest(request);

        try {

          const result =
            await assignSimToTracker(
              app.prisma,
              app.tracking3d,
              identifier,
              simIdentifier
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
            action: "assign-sim",
            resource: identifier,
            success: true,
            message: result.replication.synced
              ? undefined
              : `Asignado local; falló replicación en 3Dtracking: ${result.replication.message}`,
            requestBody: request.body,
            beforeState: result.before,
            afterState: result.tracker
          });

          return reply.send({

            success: true,

            data: result.tracker,

            sim: result.sim,

            tracking3d: result.replication

          });

        } catch (error) {

          if (error instanceof TrackerValidationError) {

            await logAction(app.prisma, {
              ...actor,
              module: "trackers",
              action: "assign-sim",
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
            action: "assign-sim",
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
                "Error asignando el SIM"

            });

        }

      }
    );

    /**
     * Quitar el SIM asignado a un tracker
     *
     * Actualiza local siempre primero — Tracker.simUid a null y, de
     * forma bidireccional, el Sim.trackerUid correspondiente a null
     * — y, si el tracker ya tiene uid, replica con
     * devices/tracker/{Uid}/deallocatesim. Registra en el log de
     * auditoría.
     *
     * DELETE
     * /api/v1/tracking/trackers/:id/sim
     */
    app.delete<{
      Params: TrackerIdParams;
    }>(
      "/trackers/:id/sim",
      {
        preHandler: async (request, reply) => {

          await request.jwtVerify();
          await requireWrite(request, reply);

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
            await deallocateSimFromTracker(
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
            action: "deallocate-sim",
            resource: identifier,
            success: true,
            message: result.replication.synced
              ? undefined
              : `Desasignado local; no replicado en 3Dtracking: ${result.replication.message}`,
            beforeState: result.before,
            afterState: result.tracker
          });

          return reply.send({

            success: true,

            data: result.tracker,

            sim: result.sim,

            tracking3d: result.replication

          });

        } catch (error) {

          if (error instanceof TrackerValidationError) {

            await logAction(app.prisma, {
              ...actor,
              module: "trackers",
              action: "deallocate-sim",
              resource: identifier,
              success: false,
              message: error.message
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
            action: "deallocate-sim",
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
                "Error quitando el SIM"

            });

        }

      }
    );

    /**
     * Eliminar un tracker (borrado físico)
     *
     * Intenta eliminarlo primero en 3Dtracking
     * (devices/tracker/{Uid}/delete, si ya tenía uid) y luego lo
     * borra de verdad de la tabla local — la fila deja de existir. El
     * registro completo (beforeState) y el resultado de la réplica
     * quedan en el log de auditoría, que es la única constancia de
     * que existió y cómo estaba configurado. :id acepta uid o imei.
     *
     * DELETE
     * /api/v1/tracking/trackers/:id
     */
    app.delete<{
      Params: TrackerIdParams;
    }>(
      "/trackers/:id",
      {
        preHandler: async (request, reply) => {

          await request.jwtVerify();
          await requireWrite(request, reply);

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
              : `Eliminado local; no replicado en 3Dtracking: ${result.replication.message}`,
            beforeState: result.before
          });

          return reply.send({

            success: true,

            data: { ...result.before, deleted: true },

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
        preHandler: async (request, reply) => {

          await request.jwtVerify();
          await requireWrite(request, reply);

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
