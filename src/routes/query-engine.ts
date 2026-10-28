import { FastifyPluginAsync } from "fastify";

import { routeQuery } from "../services/query-engine.service";

interface AskBody {
  text?: string;
}

/**
 * Endpoint de prueba del motor de consultas del chatbot (router por
 * palabras clave, ver query-engine.service.ts). Pensado para
 * verificar el motor por API/Postman mientras no existe todavía el
 * canal real (WhatsApp) ni el módulo de chat del frontend — el
 * usuario decidió 2026-10-26 dejar la integración de WhatsApp para el
 * final y probar mientras tanto por chat local y API.
 */
const queryEngineRoutes: FastifyPluginAsync = async (app) => {

  app.post<{
    Body: AskBody;
  }>(
    "/query-engine/ask",
    {
      preHandler: async (request) => {
        await request.jwtVerify();
      }
    },
    async (request, reply) => {

      const text = request.body?.text?.trim();

      if (!text) {
        return reply.code(400).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "text es requerido"
        });
      }

      try {

        const result = await routeQuery(app.prisma, app.tracking3d, {
          text,
          userId: request.user.sub,
          role: request.user.role
        });

        return reply.send({ success: true, data: result });

      } catch (error) {

        app.log.error(error);

        return reply.code(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error procesando la consulta"
        });
      }
    }
  );

};

export default queryEngineRoutes;
