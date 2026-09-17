import {
  FastifyPluginAsync
} from "fastify";

import {
  scanForCriticalAlerts
} from "../services/critical-alert.service";

import { requireRoot } from "../services/access-control.service";

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

          const [alerts, total] =
            await Promise.all([
              app.prisma.criticalAlertType.findMany({
                where,
                skip,
                take: limit,
                orderBy: { id: "asc" }
              }),

              app.prisma.criticalAlertType.count({
                where
              })
            ]);

          return reply.send({

            success: true,

            data: alerts,

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
            OR?: Array<{
              unitName?: { contains: string };
              unitImei?: { contains: string };
              description?: { contains: string };
            }>;
          } = {};

          if (request.query.alertTypeCode) {
            where.alertTypeCode = request.query.alertTypeCode.trim();
          }

          if (request.query.unitUid) {
            where.unitUid = request.query.unitUid.trim();
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

          const [events, total] =
            await Promise.all([
              app.prisma.criticalAlertEvent.findMany({
                where,
                skip,
                take: limit,
                orderBy: { occurredAt: "desc" }
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

          const data: { notifyWhatsapp?: boolean; active?: boolean } = {};

          if (request.body.notifyWhatsapp !== undefined) {
            data.notifyWhatsapp = request.body.notifyWhatsapp;
          }

          if (request.body.active !== undefined) {
            data.active = request.body.active;
          }

          const updated = await app.prisma.criticalAlertType.update({
            where: { id },
            data
          });

          return reply.send({
            success: true,
            data: updated
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

  };

export default criticalAlertRoutes;
