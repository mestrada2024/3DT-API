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

import { requireRoot } from "../services/access-control.service";
import { dispatchPendingWhatsappAlerts } from "../services/whatsapp-dispatch.service";


interface UpdateAlertConfigBody {
  accountId?: string;
  channelId?: string;
  templateId?: string;
  templateLabel?: string;
  templateText?: string;
  active?: boolean;
}

const ALERT_CONFIG_ID = 1;

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

    /**
     * GET /api/v1/messaging/alert-config
     *
     * Configuración (una sola fila) de la plantilla de WhatsApp usada
     * para notificar alertas críticas — ver
     * CriticalAlertType.notifyWhatsapp y docs/dms-messaging.md. Root
     * únicamente: incluye accountId/channelId, configuración global de
     * la cuenta, no por empresa.
     */
    app.get(
      "/messaging/alert-config",
      {
        preHandler: async (request, reply) => {

          await request.jwtVerify();
          await requireRoot(request, reply);

        }
      },
      async (request, reply) => {

        try {

          const config = await app.prisma.whatsappAlertConfig.findUnique({
            where: { id: ALERT_CONFIG_ID }
          });

          return reply.send({
            success: true,
            data: config || {
              id: ALERT_CONFIG_ID,
              accountId: null,
              channelId: null,
              templateId: null,
              templateLabel: null,
              templateText: null,
              active: false
            }
          });

        } catch (error) {

          app.log.error(error);

          return reply
            .code(500)
            .send({
              success: false,
              error: "INTERNAL_SERVER_ERROR",
              message: "Error obteniendo la configuración de plantilla"
            });
        }
      }
    );

    /**
     * PUT /api/v1/messaging/alert-config
     *
     * Crea/actualiza la configuración. templateId puede quedar null
     * hasta tener la plantilla real aprobada por DMS SMART — active
     * debería quedar en false mientras tanto (no hay wiring automático
     * de envío todavía, esto solo guarda la configuración).
     */
    app.put<{
      Body: UpdateAlertConfigBody;
    }>(
      "/messaging/alert-config",
      {
        preHandler: async (request, reply) => {

          await request.jwtVerify();
          await requireRoot(request, reply);

        }
      },
      async (request, reply) => {

        const actor = getActorFromRequest(request);

        try {

          const before = await app.prisma.whatsappAlertConfig.findUnique({
            where: { id: ALERT_CONFIG_ID }
          });

          const data = {
            accountId: request.body.accountId?.trim() || null,
            channelId: request.body.channelId?.trim() || null,
            templateId: request.body.templateId?.trim() || null,
            templateLabel: request.body.templateLabel?.trim() || null,
            templateText: request.body.templateText?.trim() || null,
            active: request.body.active ?? false
          };

          const updated = await app.prisma.whatsappAlertConfig.upsert({
            where: { id: ALERT_CONFIG_ID },
            create: { id: ALERT_CONFIG_ID, ...data },
            update: data
          });

          await logAction(app.prisma, {
            ...actor,
            module: "messaging",
            action: "update-alert-config",
            resource: "alert-config",
            success: true,
            beforeState: before,
            afterState: updated
          });

          return reply.send({
            success: true,
            data: updated
          });

        } catch (error) {

          app.log.error(error);

          return reply
            .code(500)
            .send({
              success: false,
              error: "INTERNAL_SERVER_ERROR",
              message: "Error guardando la configuración de plantilla"
            });
        }
      }
    );

	    /**
     * POST /api/v1/messaging/dispatch-alerts
     *
     * Lee CriticalAlertEvent en busca de alertas pendientes
     * (whatsappStatus null, contactPhone resuelto, tipo permitido —
     * ver whatsapp-dispatch.service.ts) y las envía por WhatsApp vía
     * DMS SMART, marcando el resultado en la misma fila. Invocación
     * manual bajo demanda (root) — no revisa
     * WhatsappAlertConfig.active, ese flag es para un futuro disparo
     * automático en segundo plano.
     */
    app.post(
      "/messaging/dispatch-alerts",
      {
        preHandler: async (request, reply) => {

          await request.jwtVerify();
          await requireRoot(request, reply);

        }
      },
      async (request, reply) => {

        const actor = getActorFromRequest(request);

        try {

          const result = await dispatchPendingWhatsappAlerts(app.prisma, app.dmsMessaging);

          await logAction(app.prisma, {
            ...actor,
            module: "messaging",
            action: "dispatch-alerts",
            resource: "critical-alert-events",
            success: true,
            message: `attempted=${result.attempted} sent=${result.sent} failed=${result.failed}`
          });

          return reply.send({
            success: true,
            data: result
          });

        } catch (error) {

          app.log.error(error);

          await logAction(app.prisma, {
            ...actor,
            module: "messaging",
            action: "dispatch-alerts",
            resource: "critical-alert-events",
            success: false,
            message: (error as Error).message
          });

          return reply
            .code(500)
            .send({
              success: false,
              error: "INTERNAL_SERVER_ERROR",
              message: "Error despachando alertas por WhatsApp"
            });
        }
      }
    );


  };

export default messagingRoutes;
