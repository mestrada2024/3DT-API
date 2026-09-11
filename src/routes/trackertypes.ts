import {
  FastifyPluginAsync
} from "fastify";

import {
  syncTrackerTypesFromTrackers
} from "../services/trackertype-sync.service";

interface TrackerTypesListQuery {
  page?: string;
  limit?: string;
  search?: string;
}

const trackerTypeRoutes:
  FastifyPluginAsync =
  async (app) => {

    /**
     * Listar tipos de GPS/tracker locales (con búsqueda).
     *
     * GET
     * /api/v1/tracking/trackertypes/local
     *
     * Parámetros:
     * ?page=1
     * ?limit=20
     * ?search=ABC  (busca en uid, name)
     */
    app.get<{
      Querystring: TrackerTypesListQuery;
    }>(
      "/trackertypes/local",
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
            }>;
          } = {};

          if (request.query.search) {
            const search = request.query.search.trim();

            if (search) {
              where.OR = [
                { uid: { contains: search } },
                { name: { contains: search } }
              ];
            }
          }

          const [trackerTypes, total] =
            await Promise.all([
              app.prisma.trackerType.findMany({
                where,
                skip,
                take: limit,
                orderBy: { id: "asc" }
              }),

              app.prisma.trackerType.count({
                where
              })
            ]);

          return reply.send({

            success: true,

            data: trackerTypes,

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
                "Error obteniendo tipos de GPS"

            });

        }

      }
    );

    /**
     * Forzar una sincronización inmediata de tipos de GPS, derivada
     * de los TrackerTypeUid/TrackerTypeName presentes en
     * devices/tracker/list (ver services/trackertype-sync.service.ts
     * para el porqué).
     *
     * POST
     * /api/v1/tracking/trackertypes/sync
     */
    app.post(
      "/trackertypes/sync",
      {
        preHandler: async (request) => {

          await request.jwtVerify();

        }
      },
      async (request, reply) => {

        try {

          const result =
            await syncTrackerTypesFromTrackers(
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
                "No se pudo sincronizar tipos de GPS con 3Dtracking"

            });

        }

      }
    );

  };

export default trackerTypeRoutes;
