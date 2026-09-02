import {
  FastifyPluginAsync
} from "fastify";

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

  };

export default trackingRoutes;