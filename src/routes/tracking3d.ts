import { FastifyPluginAsync } from "fastify";

const trackingRoutes: FastifyPluginAsync = async (app) => {

  app.get("/test-auth", {
    preHandler: async (request) => {
      await request.jwtVerify();
    }
  }, async (request, reply) => {

    try {

      const session = await app.tracking3d.authenticate();

      return {
        success: true,
        message: "3Dtracking authentication successful",
        session: {
          userIdGuid: session.userIdGuid,
          sessionId: session.sessionId
        }
      };

    } catch (error) {

      app.log.error(error);

      return reply.code(502).send({
        success: false,
        message: "Unable to authenticate with 3Dtracking"
      });

    }

  });

};

export default trackingRoutes;
