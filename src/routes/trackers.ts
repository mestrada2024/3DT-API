import {
  FastifyPluginAsync
} from "fastify";

import {
  syncTrackersFromTracking3D
} from "../services/tracker-sync.service";

interface TrackersListQuery {
  page?: string;
  limit?: string;
  search?: string;
}

const trackerRoutes:
  FastifyPluginAsync =
  async (app) => {

    /**
     * Listar trackers locales (con búsqueda).
     *
     * Esta tabla se sincroniza automáticamente cada domingo a las
     * 00:00 (hora del servidor). Este endpoint solo lee la tabla
     * local: POST /trackers/sync fuerza una sincronización inmediata.
     *
     * GET
     * /api/v1/tracking/trackers/local
     *
     * Parámetros:
     * ?page=1
     * ?limit=20
     * ?search=ABC  (busca en uid, name, imei, trackerTypeName, unitModelName)
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
            OR?: Array<{
              uid?: { contains: string };
              name?: { contains: string };
              imei?: { contains: string };
              trackerTypeName?: { contains: string };
              unitModelName?: { contains: string };
            }>;
          } = {};

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
     * Forzar una sincronización inmediata de trackers desde
     * 3Dtracking (la misma que corre automáticamente cada domingo a
     * las 00:00).
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

  };

export default trackerRoutes;
