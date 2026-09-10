import {
  FastifyPluginAsync
} from "fastify";

import {
  createSimAndReplicate,
  importSimsAndReplicate,
  updateSimAndReplicate,
  deleteSimAndReplicate,
  SimCreateInput,
  SimValidationError,
  SimDuplicateError
} from "../services/sims-sync.service";

import {
  logAction,
  getActorFromRequest
} from "../services/audit-log.service";

interface CreateSimBody {
  iccid?: string;
  phoneNumber?: string;
  pin?: string;
  puk?: string;
  trackerUid?: string;
}

interface ImportSimsBody {
  sims?: CreateSimBody[];
}

interface UpdateSimBody {
  phoneNumber?: string;
  pin?: string;
  puk?: string;
  trackerUid?: string;
}

interface SimIdParams {
  id: string;
}

interface SimsListQuery {
  page?: string;
  limit?: string;
  search?: string;
  active?: string;
  syncStatus?: string;
}

const MAX_SIMS_PER_IMPORT = 500;

const trackingRoutes:
  FastifyPluginAsync =
  async (app) => {

    /**
     * Test de autenticación
     *
     * GET
     * /api/v1/tracking/test-auth
     */
    app.get(
      "/test-auth",
      {
        preHandler: async (request) => {

          await request.jwtVerify();

        }
      },
      async (request, reply) => {

        try {

          const session =
            await app.tracking3d.authenticate();

          return {

            success: true,

            message:
              "3Dtracking authentication successful",

            session: {

              userIdGuid:
                session.userIdGuid,

              sessionId:
                session.sessionId

            }

          };

        } catch (error) {

          app.log.error(error);

          return reply
            .code(502)
            .send({

              success: false,

              error:
                "TRACKING3D_AUTH_ERROR",

              message:
                "Unable to authenticate with 3Dtracking"

            });

        }
      }
    );

    /**
     * Obtener últimas posiciones
     *
     * GET
     * /api/v1/tracking/latest-positions
     */
    app.get(
      "/latest-positions",
      {
        preHandler: async (request) => {

          await request.jwtVerify();

        }
      },
      async (request, reply) => {

        try {

          const data =
            await app.tracking3d
              .getLatestPositions();

          return {

            success: true,

            data

          };

        } catch (error) {

          app.log.error(error);

          return reply
            .code(502)
            .send({

              success: false,

              error:
                "TRACKING3D_ERROR",

              message:
                "Unable to obtain positions from 3Dtracking"

            });

        }

      }
    );

    /**
     * Listar SIMs
     *
     * GET
     * /api/v1/tracking/sims
     */
    app.get(
      "/sims",
      {
        preHandler: async (request) => {

          await request.jwtVerify();

        }
      },
      async (request, reply) => {

        try {

          const session =
            await app.tracking3d.authenticate();

          const sims =
            await app.tracking3d.getSimList(session);

          return {

            success: true,

            data: sims

          };

        } catch (error) {

          app.log.error(error);

          return reply
            .code(502)
            .send({

              success: false,

              error:
                "TRACKING3D_ERROR",

              message:
                "Unable to obtain SIM cards from 3Dtracking"

            });

        }

      }
    );

    /**
     * Listar SIMs locales (con búsqueda)
     *
     * Lee la tabla local Sim (a diferencia de GET /sims, que consulta
     * en vivo a 3Dtracking). Por defecto solo muestra los activos
     * (active: true); ?active=false para ver los borrados lógicamente.
     *
     * GET
     * /api/v1/tracking/sims/local
     *
     * Parámetros:
     * ?page=1
     * ?limit=20
     * ?search=ABC        (busca en iccid, phoneNumber, trackerUid)
     * ?active=false
     * ?syncStatus=error  (pending | synced | error | deleted)
     */
    app.get<{
      Querystring: SimsListQuery;
    }>(
      "/sims/local",
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
            syncStatus?: string;
            OR?: Array<{
              iccid?: { contains: string };
              phoneNumber?: { contains: string };
              trackerUid?: { contains: string };
            }>;
          } = {
            active:
              request.query.active === "false"
                ? false
                : true
          };

          if (request.query.syncStatus) {
            where.syncStatus = request.query.syncStatus;
          }

          if (request.query.search) {
            const search = request.query.search.trim();

            if (search) {
              where.OR = [
                { iccid: { contains: search } },
                { phoneNumber: { contains: search } },
                { trackerUid: { contains: search } }
              ];
            }
          }

          const [sims, total] =
            await Promise.all([
              app.prisma.sim.findMany({
                where,
                skip,
                take: limit,
                orderBy: { id: "asc" }
              }),

              app.prisma.sim.count({
                where
              })
            ]);

          return reply.send({

            success: true,

            data: sims,

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
                "Error obteniendo SIMs"

            });

        }

      }
    );

    /**
     * Buscar un SIM local
     *
     * Busca por iccid o externalId (incluye borrados lógicamente).
     *
     * GET
     * /api/v1/tracking/sims/local/:id
     */
    app.get<{
      Params: SimIdParams;
    }>(
      "/sims/local/:id",
      {
        preHandler: async (request) => {

          await request.jwtVerify();

        }
      },
      async (request, reply) => {

        try {

          const identifier = request.params.id.trim();

          if (!identifier) {

            return reply
              .code(400)
              .send({

                success: false,

                error:
                  "INVALID_IDENTIFIER",

                message:
                  "El identificador del SIM no es válido"

              });

          }

          const sim =
            await app.prisma.sim.findFirst({
              where: {
                OR: [
                  { iccid: identifier },
                  { externalId: identifier }
                ]
              }
            });

          if (!sim) {

            return reply
              .code(404)
              .send({

                success: false,

                error:
                  "SIM_NOT_FOUND",

                message:
                  "SIM no encontrado"

              });

          }

          return reply.send({

            success: true,

            data: sim

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
                "Error buscando el SIM"

            });

        }

      }
    );

    /**
     * Crear un SIM individual
     *
     * Antes de escribir nada, valida (local + consulta en vivo a
     * 3Dtracking) que iccid/phoneNumber no estén ya en uso. Si pasa la
     * validación, se guarda en la base local y luego se replica en
     * 3Dtracking. Si la replicación falla, el SIM queda creado
     * localmente con syncStatus "error" (ver campo tracking3d en la
     * respuesta). Registra en el log de auditoría quién lo ejecutó.
     *
     * POST
     * /api/v1/tracking/sims
     */
    app.post<{
      Body: CreateSimBody;
    }>(
      "/sims",
      {
        preHandler: async (request) => {

          await request.jwtVerify();

        }
      },
      async (request, reply) => {

        const iccid = request.body?.iccid?.trim();

        if (!iccid) {

          return reply
            .code(400)
            .send({

              success: false,

              error:
                "INVALID_BODY",

              message:
                "El campo iccid es requerido"

            });

        }

        const actor = getActorFromRequest(request);

        try {

          const { sim, replication, revived } =
            await createSimAndReplicate(
              app.prisma,
              app.tracking3d,
              { ...request.body, iccid }
            );

          await logAction(app.prisma, {
            ...actor,
            module: "sims",
            action: revived ? "create-revive" : "create",
            resource: iccid,
            success: true,
            message: replication.synced
              ? undefined
              : `${revived ? "Reactivado" : "Creado"} local; falló replicación en 3Dtracking: ${replication.message}`
          });

          return reply
            .code(201)
            .send({

              success: true,

              data: sim,

              revived,

              tracking3d: replication

            });

        } catch (error: any) {

          if (error instanceof SimDuplicateError) {

            await logAction(app.prisma, {
              ...actor,
              module: "sims",
              action: "create",
              resource: iccid,
              success: false,
              message: error.message
            });

            return reply
              .code(409)
              .send({

                success: false,

                error:
                  "SIM_ALREADY_EXISTS",

                field: error.field,

                source: error.source,

                message: error.message

              });

          }

          if (error instanceof SimValidationError || error?.code === "P2002") {

            await logAction(app.prisma, {
              ...actor,
              module: "sims",
              action: "create",
              resource: iccid,
              success: false,
              message: error.message
            });

            return reply
              .code(error?.code === "P2002" ? 409 : 400)
              .send({

                success: false,

                error:
                  error?.code === "P2002" ? "SIM_ALREADY_EXISTS" : "INVALID_BODY",

                message: error.message

              });

          }

          app.log.error(error);

          await logAction(app.prisma, {
            ...actor,
            module: "sims",
            action: "create",
            resource: iccid,
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
                "Error creando el SIM"

            });

        }

      }
    );

    /**
     * Importar SIMs de forma masiva
     *
     * Antes de crear, se autentica y consulta una sola vez la lista de
     * 3Dtracking para validar duplicados de todo el lote. Cada
     * registro se guarda primero en la base local y luego se replica
     * en 3Dtracking de forma independiente: un fallo en un registro no
     * detiene el resto (ver detalle por item en la respuesta). Registra
     * un log de auditoría por lote (quién lo ejecutó, cuántos se
     * crearon).
     *
     * POST
     * /api/v1/tracking/sims/import
     */
    app.post<{
      Body: ImportSimsBody;
    }>(
      "/sims/import",
      {
        preHandler: async (request) => {

          await request.jwtVerify();

        }
      },
      async (request, reply) => {

        const sims = request.body?.sims;

        if (!Array.isArray(sims) || sims.length === 0) {

          return reply
            .code(400)
            .send({

              success: false,

              error:
                "INVALID_BODY",

              message:
                "El campo sims debe ser un arreglo con al menos un elemento"

            });

        }

        if (sims.length > MAX_SIMS_PER_IMPORT) {

          return reply
            .code(400)
            .send({

              success: false,

              error:
                "TOO_MANY_SIMS",

              message:
                `El máximo por importación es ${MAX_SIMS_PER_IMPORT} SIMs`

            });

        }

        const actor = getActorFromRequest(request);

        try {

          const result =
            await importSimsAndReplicate(
              app.prisma,
              app.tracking3d,
              sims as SimCreateInput[]
            );

          await logAction(app.prisma, {
            ...actor,
            module: "sims",
            action: "import",
            resource: `${result.created}/${result.total} creados`,
            success: result.errors === 0,
            message: result.errors > 0
              ? `${result.errors} de ${result.total} registros fallaron`
              : undefined
          });

          return reply.send({

            success: true,

            data: result

          });

        } catch (error) {

          app.log.error(error);

          const message = error instanceof Error ? error.message : "Error desconocido";

          await logAction(app.prisma, {
            ...actor,
            module: "sims",
            action: "import",
            resource: `0/${sims.length} creados`,
            success: false,
            message
          });

          return reply
            .code(502)
            .send({

              success: false,

              error:
                "TRACKING3D_ERROR",

              message:
                `No se pudo consultar 3Dtracking para validar el lote: ${message}`

            });

        }

      }
    );

    /**
     * Actualizar un SIM
     *
     * Antes de escribir, valida (local + consulta en vivo a
     * 3Dtracking) que el phoneNumber nuevo no esté ya en uso por otro
     * SIM. Actualiza phoneNumber/pin/puk/trackerUid en la base local
     * y, si el SIM ya tiene externalId (fue creado en 3Dtracking),
     * replica el cambio con devices/sim/{Uid}/update. :id acepta
     * iccid o externalId. Registra en el log de auditoría quién lo
     * ejecutó.
     *
     * PATCH
     * /api/v1/tracking/sims/:id
     */
    app.patch<{
      Params: SimIdParams;
      Body: UpdateSimBody;
    }>(
      "/sims/:id",
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
                "El identificador del SIM no es válido"

            });

        }

        const actor = getActorFromRequest(request);

        try {

          const result =
            await updateSimAndReplicate(
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
                  "SIM_NOT_FOUND",

                message:
                  "SIM no encontrado"

              });

          }

          await logAction(app.prisma, {
            ...actor,
            module: "sims",
            action: "update",
            resource: identifier,
            success: true,
            message: result.replication.synced
              ? undefined
              : `Actualizado local; falló replicación en 3Dtracking: ${result.replication.message}`
          });

          return reply.send({

            success: true,

            data: result.sim,

            tracking3d: result.replication

          });

        } catch (error: any) {

          if (error instanceof SimDuplicateError) {

            await logAction(app.prisma, {
              ...actor,
              module: "sims",
              action: "update",
              resource: identifier,
              success: false,
              message: error.message
            });

            return reply
              .code(409)
              .send({

                success: false,

                error:
                  "SIM_ALREADY_EXISTS",

                field: error.field,

                source: error.source,

                message: error.message

              });

          }

          app.log.error(error);

          await logAction(app.prisma, {
            ...actor,
            module: "sims",
            action: "update",
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
                "Error actualizando el SIM"

            });

        }

      }
    );

    /**
     * Eliminar un SIM (borrado lógico)
     *
     * Marca el SIM como inactivo (active: false) en la base local y,
     * si ya tenía externalId (fue creado en 3Dtracking), lo elimina
     * allá con devices/sim/{Uid}/delete. :id acepta iccid o
     * externalId. Registra en el log de auditoría quién lo ejecutó.
     *
     * DELETE
     * /api/v1/tracking/sims/:id
     */
    app.delete<{
      Params: SimIdParams;
    }>(
      "/sims/:id",
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
                "El identificador del SIM no es válido"

            });

        }

        const actor = getActorFromRequest(request);

        try {

          const result =
            await deleteSimAndReplicate(
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
                  "SIM_NOT_FOUND",

                message:
                  "SIM no encontrado"

              });

          }

          await logAction(app.prisma, {
            ...actor,
            module: "sims",
            action: "delete",
            resource: identifier,
            success: true,
            message: result.replication.synced
              ? undefined
              : `Borrado local; no replicado en 3Dtracking: ${result.replication.message}`
          });

          return reply.send({

            success: true,

            data: result.sim,

            tracking3d: result.replication

          });

        } catch (error) {

          app.log.error(error);

          await logAction(app.prisma, {
            ...actor,
            module: "sims",
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
                "Error eliminando el SIM"

            });

        }

      }
    );

  };

export default trackingRoutes;
