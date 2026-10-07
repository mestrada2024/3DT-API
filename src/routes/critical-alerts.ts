import {
  FastifyPluginAsync
} from "fastify";

import {
  scanForCriticalAlerts
} from "../services/critical-alert.service";

import { buildWhatsappPreview, resendWhatsappForEvent } from "../services/whatsapp-dispatch.service";

import { getAllowedCompanyUids, requireRoot, requireWrite } from "../services/access-control.service";

import { getActorFromRequest, logAction } from "../services/audit-log.service";

import { parseSort } from "../utils/sort";

const ALERT_EVENT_SORTABLE_FIELDS = ["occurredAt", "alertTypeName", "unitName", "whatsappStatus", "read"] as const;

interface CriticalAlertIdParams {
  id: string;
}

interface UpdateCriticalAlertBody {
  notifyWhatsapp?: boolean;
  active?: boolean;
}

interface CriticalAlertsListQuery {
  page?: string;
  limit?: string;
  search?: string;
  active?: string;
}

interface CriticalAlertEventsListQuery {
  page?: string;
  limit?: string;
  alertTypeCode?: string;
  unitUid?: string;
  search?: string;
  read?: string;
  sortBy?: string;
  sortDir?: string;
}

interface CriticalAlertEventIdParams {
  id: string;
}

interface UpdateCriticalAlertEventBody {
  read?: boolean;
}

/**
 * Alertas críticas: catálogo local, no sincronizado de 3Dtracking —
 * se define a mano (por ahora solo lectura; sembrado con "Botón de
 * pánico"). Pensado como referencia para un futuro mecanismo de
 * alertas basado en los mensajes/eventos reales de las unidades.
 */
const criticalAlertRoutes:
  FastifyPluginAsync =
  async (app) => {

    /**
     * Listar alertas críticas (con búsqueda).
     *
     * GET
     * /api/v1/tracking/critical-alerts
     *
     * Parámetros:
     * ?page=1
     * ?limit=20
     * ?search=ABC   (busca en code, name, description)
     * ?active=false (default: solo activas)
     */
    app.get<{
      Querystring: CriticalAlertsListQuery;
    }>(
      "/critical-alerts",
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
            active: boolean;
            OR?: Array<{
              code?: { contains: string };
              name?: { contains: string };
              description?: { contains: string };
            }>;
          } = {
            active:
              request.query.active === "false"
                ? false
                : true
          };

          if (request.query.search) {
            const search = request.query.search.trim();

            if (search) {
              where.OR = [
                { code: { contains: search } },
                { name: { contains: search } },
                { description: { contains: search } }
              ];
            }
          }

          const [alerts, total, allowed] =
            await Promise.all([
              app.prisma.criticalAlertType.findMany({
                where,
                skip,
                take: limit,
                orderBy: { id: "asc" }
              }),

              app.prisma.criticalAlertType.count({
                where
              }),

              app.prisma.allowedAlertType.findMany({
                select: { alertTypeCode: true }
              })
            ]);

          const allowedCodes = new Set(allowed.map((a) => a.alertTypeCode));

          const alertsWithNotify = alerts.map((alert) => ({
            ...alert,
            notifyWhatsapp: allowedCodes.has(alert.code)
          }));

          return reply.send({

            success: true,

            data: alertsWithNotify,

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
                "Error obteniendo alertas críticas"

            });

        }

      }
    );

    /**
     * Escanear alertas críticas
     *
     * Revisa la posición más reciente de cada unidad
     * (Units/LatestPositionsList) contra los tipos de alerta activos
     * (los que tengan matchSystemName definido) y guarda un
     * CriticalAlertEvent por cada coincidencia activa nueva (ver
     * services/critical-alert.service.ts). No es recurrente/
     * programado — se ejecuta bajo demanda, por ahora.
     *
     * POST
     * /api/v1/tracking/critical-alerts/scan
     */
    app.post(
      "/critical-alerts/scan",
      {
        preHandler: async (request) => {

          await request.jwtVerify();

        }
      },
      async (request, reply) => {

        try {

          const result =
            await scanForCriticalAlerts(
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
                "TRACKING3D_ERROR",

              message:
                "No se pudo escanear alertas críticas contra 3Dtracking"

            });

        }

      }
    );

    /**
     * Listar eventos de alerta crítica detectados (con búsqueda y
     * filtros).
     *
     * GET
     * /api/v1/tracking/critical-alerts/events
     *
     * Parámetros:
     * ?page=1
     * ?limit=20
     * ?alertTypeCode=PANIC_BUTTON
     * ?unitUid=D1D077
     * ?search=ABC  (busca en unitName, unitImei, description)
     */
    app.get<{
      Querystring: CriticalAlertEventsListQuery;
    }>(
      "/critical-alerts/events",
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
            alertTypeCode?: string;
            unitUid?: string;
            companyUid?: { in: string[] };
            read?: boolean;
            OR?: Array<{
              unitName?: { contains: string };
              unitImei?: { contains: string };
              description?: { contains: string };
            }>;
          } = {};

          /**
           * root ve todos los eventos; admin/user solo los de sus
           * empresas asignadas (UserCompany) — mismo criterio que
           * units.ts. Cero empresas asignadas = cero eventos.
           */
          const allowedCompanyUids = await getAllowedCompanyUids(
            app.prisma,
            request.user.sub,
            request.user.role
          );

          if (allowedCompanyUids !== null) {
            where.companyUid = { in: allowedCompanyUids };
          }

          if (request.query.alertTypeCode) {
            where.alertTypeCode = request.query.alertTypeCode.trim();
          }

          if (request.query.unitUid) {
            where.unitUid = request.query.unitUid.trim();
          }

          if (request.query.read === "true") {
            where.read = true;
          } else if (request.query.read === "false") {
            where.read = false;
          }

          if (request.query.search) {
            const search = request.query.search.trim();

            if (search) {
              where.OR = [
                { unitName: { contains: search } },
                { unitImei: { contains: search } },
                { description: { contains: search } }
              ];
            }
          }

          /**
           * Sin sortBy explícito (click en una columna del frontend):
           * orden por defecto con las alertas pendientes de WhatsApp
           * primero (whatsappStatus NULL ordena primero en ASC) y,
           * dentro de cada grupo, las más recientes primero — pedido
           * explícito del usuario 2026-10-06 para no tener que buscar
           * las pendientes entre las ya enviadas.
           */
          const orderBy = request.query.sortBy
            ? (() => {
                const { field, direction } = parseSort(
                  request.query.sortBy,
                  request.query.sortDir,
                  ALERT_EVENT_SORTABLE_FIELDS,
                  "occurredAt"
                );
                return { [field]: direction };
              })()
            : [{ whatsappStatus: "asc" as const }, { occurredAt: "desc" as const }];

          const [events, total] =
            await Promise.all([
              app.prisma.criticalAlertEvent.findMany({
                where,
                skip,
                take: limit,
                orderBy
              }),

              app.prisma.criticalAlertEvent.count({
                where
              })
            ]);

          return reply.send({

            success: true,

            data: events,

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
                "Error obteniendo eventos de alerta crítica"

            });

        }

      }
    );

    /**
     * PATCH /api/v1/tracking/critical-alerts/:id
     *
     * Activa/desactiva el envío por WhatsApp de un tipo de alerta
     * (notifyWhatsapp) y/o si está activa en el escaneo (active). Es
     * una configuración global de la cuenta (no por empresa), por eso
     * requiere rol root — ver docs/dms-messaging.md.
     */
    app.patch<{
      Params: CriticalAlertIdParams;
      Body: UpdateCriticalAlertBody;
    }>(
      "/critical-alerts/:id",
      {
        preHandler: async (request, reply) => {

          await request.jwtVerify();
          await requireRoot(request, reply);

        }
      },
      async (request, reply) => {

        try {

          const id = parseInt(request.params.id, 10);

          if (isNaN(id)) {
            return reply
              .code(400)
              .send({
                success: false,
                error: "INVALID_ID",
                message: "id inválido"
              });
          }

          const data: { active?: boolean } = {};

          if (request.body.active !== undefined) {
            data.active = request.body.active;
          }

          const updated = Object.keys(data).length
            ? await app.prisma.criticalAlertType.update({ where: { id }, data })
            : await app.prisma.criticalAlertType.findUniqueOrThrow({ where: { id } });

          if (request.body.notifyWhatsapp !== undefined) {

            if (request.body.notifyWhatsapp) {

              await app.prisma.allowedAlertType.upsert({
                where: { alertTypeCode: updated.code },
                create: { alertTypeCode: updated.code },
                update: {}
              });

            } else {

              await app.prisma.allowedAlertType.deleteMany({
                where: { alertTypeCode: updated.code }
              });
            }
          }

          const allowedNow = await app.prisma.allowedAlertType.findUnique({
            where: { alertTypeCode: updated.code }
          });

          return reply.send({
            success: true,
            data: { ...updated, notifyWhatsapp: Boolean(allowedNow) }
          });

        } catch (error: any) {

          if (error?.code === "P2025") {
            return reply
              .code(404)
              .send({
                success: false,
                error: "NOT_FOUND",
                message: "Tipo de alerta no encontrado"
              });
          }

          app.log.error(error);

          return reply
            .code(500)
            .send({
              success: false,
              error: "INTERNAL_SERVER_ERROR",
              message: "Error actualizando el tipo de alerta"
            });
        }
      }
    );

    /**
     * PATCH /api/v1/tracking/critical-alerts/events/:id
     *
     * Marca (o desmarca) un evento de alerta como leído — para el
     * módulo de Alertas del frontend. No requiere rol root: cualquier
     * usuario autenticado con acceso a la empresa del evento puede
     * acusar lectura (es un ack de UI, no un cambio de configuración).
     * Independiente de whatsappStatus.
     */
    app.patch<{
      Params: CriticalAlertEventIdParams;
      Body: UpdateCriticalAlertEventBody;
    }>(
      "/critical-alerts/events/:id",
      {
        preHandler: async (request) => {

          await request.jwtVerify();

        }
      },
      async (request, reply) => {

        try {

          const id = parseInt(request.params.id, 10);

          if (isNaN(id)) {
            return reply
              .code(400)
              .send({
                success: false,
                error: "INVALID_ID",
                message: "id inválido"
              });
          }

          const event = await app.prisma.criticalAlertEvent.findUnique({
            where: { id }
          });

          if (!event) {
            return reply
              .code(404)
              .send({
                success: false,
                error: "NOT_FOUND",
                message: "Evento de alerta no encontrado"
              });
          }

          const allowedCompanyUids = await getAllowedCompanyUids(
            app.prisma,
            request.user.sub,
            request.user.role
          );

          if (allowedCompanyUids !== null && !allowedCompanyUids.includes(event.companyUid || "")) {
            return reply
              .code(404)
              .send({
                success: false,
                error: "NOT_FOUND",
                message: "Evento de alerta no encontrado"
              });
          }

          const read = request.body.read ?? true;

          const updated = await app.prisma.criticalAlertEvent.update({
            where: { id },
            data: { read, readAt: read ? new Date() : null }
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
              message: "Error actualizando el evento de alerta"
            });
        }
      }
    );

    /**
     * POST /api/v1/tracking/critical-alerts/events/:id/resend-whatsapp
     *
     * Reenvía manualmente el mensaje de WhatsApp de un evento puntual
     * — a diferencia de dispatchPendingWhatsappAlerts (automático/
     * masivo, ver whatsapp-dispatch.service.ts), esta acción es
     * explícita, por evento, y por eso no aplica el filtro de unidad
     * WHATSAPP_DISPATCH_ENABLED_UNIT_UIDS ni exige whatsappStatus
     * null (permite reenviar aunque ya se haya enviado o haya
     * fallado antes). Requiere root o admin (requireWrite) — a
     * diferencia de /messaging/dispatch-alerts (root únicamente),
     * esta acción puntual sobre una alerta visible en el módulo de
     * Alertas también la puede disparar un admin, por pedido del
     * usuario 2026-10-06.
     */
    /**
     * GET /api/v1/tracking/critical-alerts/events/:id/resend-whatsapp
     *
     * Vista previa SIN enviar — devuelve el texto exacto y los
     * números a los que se mandaría el WhatsApp si se confirma el
     * reenvío. El frontend la consulta para mostrarla en el diálogo
     * de confirmación antes de llamar al POST de abajo (ver
     * buildWhatsappPreview en whatsapp-dispatch.service.ts — ambos
     * endpoints comparten la misma función para que el texto
     * mostrado sea exactamente el que se envía).
     */
    app.get<{
      Params: CriticalAlertEventIdParams;
    }>(
      "/critical-alerts/events/:id/resend-whatsapp",
      {
        preHandler: async (request, reply) => {

          await request.jwtVerify();
          await requireWrite(request, reply);

        }
      },
      async (request, reply) => {

        const id = parseInt(request.params.id, 10);

        if (isNaN(id)) {
          return reply
            .code(400)
            .send({
              success: false,
              error: "INVALID_ID",
              message: "id inválido"
            });
        }

        try {

          const preview = await buildWhatsappPreview(app.prisma, id);

          return reply.send({
            success: true,
            data: preview
          });

        } catch (error) {

          app.log.error(error);

          return reply
            .code(500)
            .send({
              success: false,
              error: "INTERNAL_SERVER_ERROR",
              message: "Error preparando la vista previa del mensaje"
            });
        }
      }
    );

    app.post<{
      Params: CriticalAlertEventIdParams;
      Body: { phone?: string };
    }>(
      "/critical-alerts/events/:id/resend-whatsapp",
      {
        preHandler: async (request, reply) => {

          await request.jwtVerify();
          await requireWrite(request, reply);

        }
      },
      async (request, reply) => {

        const actor = getActorFromRequest(request);
        const id = parseInt(request.params.id, 10);

        if (isNaN(id)) {
          return reply
            .code(400)
            .send({
              success: false,
              error: "INVALID_ID",
              message: "id inválido"
            });
        }

        try {

          const overridePhone = request.body?.phone?.trim() || undefined;

          const result = await resendWhatsappForEvent(app.prisma, app.dmsMessaging, id, overridePhone);

          await logAction(app.prisma, {
            ...actor,
            module: "messaging",
            action: "resend-alert-whatsapp",
            resource: String(id),
            success: result.success,
            message: result.message || null
          });

          if (!result.success) {
            return reply
              .code(422)
              .send({
                success: false,
                error: "WHATSAPP_SEND_FAILED",
                message: result.message || "No se pudo reenviar el mensaje de WhatsApp"
              });
          }

          return reply.send({
            success: true,
            data: result
          });

        } catch (error) {

          app.log.error(error);

          await logAction(app.prisma, {
            ...actor,
            module: "messaging",
            action: "resend-alert-whatsapp",
            resource: String(id),
            success: false,
            message: (error as Error).message
          });

          return reply
            .code(500)
            .send({
              success: false,
              error: "INTERNAL_SERVER_ERROR",
              message: "Error reenviando el mensaje de WhatsApp"
            });
        }
      }
    );

  };

export default criticalAlertRoutes;
