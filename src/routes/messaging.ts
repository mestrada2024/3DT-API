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


interface CreateAlertTemplateBody {
  accountId?: string;
  channelId?: string;
  templateId?: string;
  templateLabel?: string;
  templateText?: string;
  active?: boolean;
}

interface UpdateAlertTemplateBody {
  accountId?: string;
  channelId?: string;
  templateId?: string;
  templateLabel?: string;
  templateText?: string;
  active?: boolean;
}

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
     * GET /api/v1/messaging/alert-templates
     *
     * Lista todas las plantillas de WhatsApp (DMS SMART) disponibles
     * para notificar alertas críticas — ver
     * CriticalAlertType.notifyWhatsapp y docs/dms-messaging.md. Root
     * únicamente. A lo sumo una tiene active=true; esa es la que usa
     * dispatchPendingWhatsappAlerts.
     */
    app.get(
      "/messaging/alert-templates",
      {
        preHandler: async (request, reply) => {

          await request.jwtVerify();
          await requireRoot(request, reply);

        }
      },
      async (request, reply) => {

        try {

          const templates = await app.prisma.whatsappAlertConfig.findMany({
            orderBy: { createdAt: "asc" }
          });

          return reply.send({
            success: true,
            data: templates
          });

        } catch (error) {

          app.log.error(error);

          return reply
            .code(500)
            .send({
              success: false,
              error: "INTERNAL_SERVER_ERROR",
              message: "Error obteniendo las plantillas"
            });
        }
      }
    );

    /**
     * POST /api/v1/messaging/alert-templates
     *
     * Crea una nueva plantilla. templateId puede quedar null hasta
     * tener la plantilla real aprobada por DMS SMART. Si se crea con
     * active=true, desactiva cualquier otra plantilla (solo puede
     * haber una activa a la vez — se aplica aquí, no hay constraint
     * de DB para esto en MariaDB).
     */
    app.post<{
      Body: CreateAlertTemplateBody;
    }>(
      "/messaging/alert-templates",
      {
        preHandler: async (request, reply) => {

          await request.jwtVerify();
          await requireRoot(request, reply);

        }
      },
      async (request, reply) => {

        const actor = getActorFromRequest(request);

        try {

          const data = {
            accountId: request.body.accountId?.trim() || null,
            channelId: request.body.channelId?.trim() || null,
            templateId: request.body.templateId?.trim() || null,
            templateLabel: request.body.templateLabel?.trim() || null,
            templateText: request.body.templateText?.trim() || null,
            active: request.body.active ?? false
          };

          const created = await app.prisma.$transaction(async (tx) => {

            if (data.active) {
              await tx.whatsappAlertConfig.updateMany({
                where: { active: true },
                data: { active: false }
              });
            }

            return tx.whatsappAlertConfig.create({ data });
          });

          await logAction(app.prisma, {
            ...actor,
            module: "messaging",
            action: "create-alert-template",
            resource: String(created.id),
            success: true,
            afterState: created
          });

          return reply.send({
            success: true,
            data: created
          });

        } catch (error) {

          app.log.error(error);

          return reply
            .code(500)
            .send({
              success: false,
              error: "INTERNAL_SERVER_ERROR",
              message: "Error creando la plantilla"
            });
        }
      }
    );

    /**
     * PATCH /api/v1/messaging/alert-templates/:id
     *
     * Actualiza una plantilla existente (campos sueltos). Si se
     * manda active=true, desactiva cualquier otra plantilla dentro
     * de la misma transacción.
     */
    app.patch<{
      Params: { id: string };
      Body: UpdateAlertTemplateBody;
    }>(
      "/messaging/alert-templates/:id",
      {
        preHandler: async (request, reply) => {

          await request.jwtVerify();
          await requireRoot(request, reply);

        }
      },
      async (request, reply) => {

        const actor = getActorFromRequest(request);
        const id = Number(request.params.id);

        if (!Number.isInteger(id)) {

          return reply
            .code(400)
            .send({
              success: false,
              error: "VALIDATION_ERROR",
              message: "id inválido"
            });
        }

        try {

          const before = await app.prisma.whatsappAlertConfig.findUnique({ where: { id } });

          if (!before) {

            return reply
              .code(404)
              .send({
                success: false,
                error: "NOT_FOUND",
                message: "Plantilla no encontrada"
              });
          }

          const body = request.body;
          const data: Record<string, unknown> = {};

          if (body.accountId !== undefined) data.accountId = body.accountId.trim() || null;
          if (body.channelId !== undefined) data.channelId = body.channelId.trim() || null;
          if (body.templateId !== undefined) data.templateId = body.templateId.trim() || null;
          if (body.templateLabel !== undefined) data.templateLabel = body.templateLabel.trim() || null;
          if (body.templateText !== undefined) data.templateText = body.templateText.trim() || null;
          if (body.active !== undefined) data.active = body.active;

          const updated = await app.prisma.$transaction(async (tx) => {

            if (data.active === true) {
              await tx.whatsappAlertConfig.updateMany({
                where: { active: true, id: { not: id } },
                data: { active: false }
              });
            }

            return tx.whatsappAlertConfig.update({ where: { id }, data });
          });

          await logAction(app.prisma, {
            ...actor,
            module: "messaging",
            action: "update-alert-template",
            resource: String(id),
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
              message: "Error actualizando la plantilla"
            });
        }
      }
    );

    /**
     * DELETE /api/v1/messaging/alert-templates/:id
     */
    app.delete<{
      Params: { id: string };
    }>(
      "/messaging/alert-templates/:id",
      {
        preHandler: async (request, reply) => {

          await request.jwtVerify();
          await requireRoot(request, reply);

        }
      },
      async (request, reply) => {

        const actor = getActorFromRequest(request);
        const id = Number(request.params.id);

        if (!Number.isInteger(id)) {

          return reply
            .code(400)
            .send({
              success: false,
              error: "VALIDATION_ERROR",
              message: "id inválido"
            });
        }

        try {

          const before = await app.prisma.whatsappAlertConfig.findUnique({ where: { id } });

          if (!before) {

            return reply
              .code(404)
              .send({
                success: false,
                error: "NOT_FOUND",
                message: "Plantilla no encontrada"
              });
          }

          await app.prisma.whatsappAlertConfig.delete({ where: { id } });

          await logAction(app.prisma, {
            ...actor,
            module: "messaging",
            action: "delete-alert-template",
            resource: String(id),
            success: true,
            beforeState: before
          });

          return reply.send({ success: true });

        } catch (error) {

          app.log.error(error);

          return reply
            .code(500)
            .send({
              success: false,
              error: "INTERNAL_SERVER_ERROR",
              message: "Error eliminando la plantilla"
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
