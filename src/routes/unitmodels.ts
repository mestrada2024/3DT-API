import {
  FastifyPluginAsync
} from "fastify";

import {
  syncUnitModelsFromTrackers
} from "../services/unitmodel-sync.service";

import {
  upsertConfigTemplate,
  getConfigTemplate,
  ConfigTemplateNotFoundError
} from "../services/tracker-config-template.service";

import {
  logAction,
  getActorFromRequest
} from "../services/audit-log.service";

interface UnitModelsListQuery {
  page?: string;
  limit?: string;
  search?: string;
}

interface UnitModelUidParams {
  uid: string;
}

interface UpsertConfigTemplateBody {
  attributes?: Record<string, string | null>;
}

const unitModelRoutes:
  FastifyPluginAsync =
  async (app) => {

    /**
     * Listar modelos de unidad locales (con búsqueda). Usados para
     * resolver trackerTypeUid a partir de unitModelName en
     * POST /trackers (ver ese endpoint).
     *
     * GET
     * /api/v1/tracking/unitmodels/local
     *
     * Parámetros:
     * ?page=1
     * ?limit=20
     * ?search=ABC  (busca en uid, name, trackerTypeName)
     */
    app.get<{
      Querystring: UnitModelsListQuery;
    }>(
      "/unitmodels/local",
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
            OR?: Array<{
              uid?: { contains: string };
              name?: { contains: string };
              trackerTypeName?: { contains: string };
            }>;
          } = {};

          if (request.query.search) {
            const search = request.query.search.trim();

            if (search) {
              where.OR = [
                { uid: { contains: search } },
                { name: { contains: search } },
                { trackerTypeName: { contains: search } }
              ];
            }
          }

          const [unitModels, total] =
            await Promise.all([
              app.prisma.unitModel.findMany({
                where,
                skip,
                take: limit,
                orderBy: { id: "asc" }
              }),

              app.prisma.unitModel.count({
                where
              })
            ]);

          return reply.send({

            success: true,

            data: unitModels,

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
                "Error obteniendo modelos de unidad"

            });

        }

      }
    );

    /**
     * Forzar una sincronización inmediata de modelos de unidad,
     * derivada de UnitModelUid/UnitModelName/TrackerTypeUid presentes
     * en devices/tracker/list (ver
     * services/unitmodel-sync.service.ts para el porqué).
     *
     * POST
     * /api/v1/tracking/unitmodels/sync
     */
    app.post(
      "/unitmodels/sync",
      {
        preHandler: async (request) => {

          await request.jwtVerify();

        }
      },
      async (request, reply) => {

        try {

          const result =
            await syncUnitModelsFromTrackers(
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
                "No se pudo sincronizar modelos de unidad con 3Dtracking"

            });

        }

      }
    );

    /**
     * Ver la plantilla de configuración de un modelo (si existe).
     *
     * GET
     * /api/v1/tracking/unitmodels/:uid/config-template
     */
    app.get<{
      Params: UnitModelUidParams;
    }>(
      "/unitmodels/:uid/config-template",
      {
        preHandler: async (request) => {

          await request.jwtVerify();

        }
      },
      async (request, reply) => {

        try {

          const template =
            await getConfigTemplate(
              app.prisma,
              request.params.uid
            );

          if (!template) {

            return reply
              .code(404)
              .send({

                success: false,

                error:
                  "CONFIG_TEMPLATE_NOT_FOUND",

                message:
                  "Este modelo no tiene plantilla de configuración todavía"

              });

          }

          return reply.send({

            success: true,

            data: template

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
                "Error obteniendo la plantilla de configuración"

            });

        }

      }
    );

    /**
     * Crear/reemplazar por completo la plantilla de configuración de
     * un modelo. attributes es un mapa { "Nombre de Usuario": "valor",
     * ... } — si se omite, se seedea con los 6 nombres conocidos y
     * valor vacío (ver DEFAULT_TRACKER_CONFIG_ATTRIBUTE_NAMES en
     * tracker-config-template.service.ts) para completarlos después
     * con otro PUT. Solo los atributos con valor no vacío se aplican
     * al crear un tracker de este modelo (ver POST /trackers).
     *
     * PUT
     * /api/v1/tracking/unitmodels/:uid/config-template
     */
    app.put<{
      Params: UnitModelUidParams;
      Body: UpsertConfigTemplateBody;
    }>(
      "/unitmodels/:uid/config-template",
      {
        preHandler: async (request) => {

          await request.jwtVerify();

        }
      },
      async (request, reply) => {

        const actor = getActorFromRequest(request);

        try {

          const template =
            await upsertConfigTemplate(
              app.prisma,
              request.params.uid,
              request.body?.attributes
            );

          await logAction(app.prisma, {
            ...actor,
            module: "unitmodels",
            action: "config-template-upsert",
            resource: request.params.uid,
            success: true,
            requestBody: request.body,
            afterState: template
          });

          return reply.send({

            success: true,

            data: template

          });

        } catch (error) {

          if (error instanceof ConfigTemplateNotFoundError) {

            return reply
              .code(404)
              .send({

                success: false,

                error:
                  "UNIT_MODEL_NOT_FOUND",

                message: error.message

              });

          }

          app.log.error(error);

          await logAction(app.prisma, {
            ...actor,
            module: "unitmodels",
            action: "config-template-upsert",
            resource: request.params.uid,
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
                "Error guardando la plantilla de configuración"

            });

        }

      }
    );

  };

export default unitModelRoutes;
