import {
  FastifyPluginAsync
} from "fastify";

import {
  DmsMessagingSendPayload
} from "../integrations/dms-messaging/messaging.types";

import {
  getActorFromRequest,
  logAction
} from "../services/audit-log.service";

/**
 * POST /api/v1/messaging/send: envío de plantillas de WhatsApp vía el
 * endpoint de campaña saliente de DMS SMART (ver docs/dms-messaging.md).
 * Es un envoltorio delgado sobre DmsMessagingClient — la lógica de
 * conexión (Basic Auth, manejo del cuerpo de respuesta) vive en
 * src/integrations/dms-messaging/messaging.client.ts.
 */
const messagingRoutes:
  FastifyPluginAsync =
  async (app) => {

    app.post<{
      Body: DmsMessagingSendPayload;
    }>(
      "/messaging/send",
      {
        preHandler: async (request) => {

          await request.jwtVerify();

        }
      },
      async (request, reply) => {

        const actor = getActorFromRequest(request);
        const payload = request.body;

        if (!payload?.phone || !payload?.accountId || !payload?.templateId) {

          return reply
            .code(400)
            .send({
              success: false,
              error: "VALIDATION_ERROR",
              message: "phone, accountId y templateId son requeridos"
            });
        }

        try {

          const result =
            await app.dmsMessaging.sendMessage(payload);

          await logAction(app.prisma, {
            ...actor,
            module: "messaging",
            action: "send",
            resource: payload.phone,
            success: result.success,
            message: result.message || result.error || null,
            requestBody: payload
          });

          return reply
            .code(result.httpStatus)
            .send(result);

        } catch (error) {

          app.log.error(error);

          await logAction(app.prisma, {
            ...actor,
            module: "messaging",
            action: "send",
            resource: payload.phone,
            success: false,
            message: (error as Error).message,
            requestBody: payload
          });

          return reply
            .code(502)
            .send({
              success: false,
              error: "DMS_MESSAGING_ERROR",
              message: "No se pudo conectar con la API de mensajería"
            });
        }
      }
    );

  };

export default messagingRoutes;
