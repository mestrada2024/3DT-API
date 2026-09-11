import {
  FastifyPluginAsync
} from "fastify";

import {
  syncUnitModelsFromTrackers
} from "../services/unitmodel-sync.service";

interface UnitModelsListQuery {
  page?: string;
  limit?: string;
  search?: string;
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

  };

export default unitModelRoutes;
