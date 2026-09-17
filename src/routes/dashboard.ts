import { FastifyPluginAsync } from "fastify";

import {
  getDashboardCounts,
  getTopCompaniesByTransmitting,
  getTopUnitsByAlarms,
  getTopUnitsByTripAndIdleTime
} from "../services/dashboard.service";

import { getAllowedCompanyUids } from "../services/access-control.service";

interface DashboardQuery {
  date?: string;
}

/**
 * GET /api/v1/dashboard/summary
 *
 * Resumen del Dashboard: contadores actuales (activas/inactivas/
 * transmitiendo/sin transmitir >1 día/total unidades/total empresas)
 * más los top-5 (empresas con más unidades transmitiendo, unidades
 * con más tiempo en viaje/ralentí/transmitiendo-apagado, unidades con
 * más alarmas). Todo respeta las empresas asignadas al usuario (ver
 * access-control.service.ts) — root ve todo.
 *
 * Los contadores reflejan el estado ACTUAL (no tienen sentido
 * point-in-time histórico); el filtro de fecha (?date=YYYY-MM-DD,
 * default hoy) aplica a los top-5 de tiempo en viaje/ralentí/
 * transmitiendo-apagado/alarmas, que sí son acumulados sobre un
 * período.
 */
const dashboardRoutes: FastifyPluginAsync = async (app) => {

  app.get<{ Querystring: DashboardQuery }>(
    "/dashboard/summary",
    {
      preHandler: async (request) => {
        await request.jwtVerify();
      }
    },
    async (request, reply) => {

      try {

        const dateParam = request.query.date?.trim();

        const date =
          dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
            ? dateParam
            : new Date().toISOString().slice(0, 10);

        const range = {
          from: new Date(`${date}T00:00:00.000Z`),
          to: new Date(`${date}T23:59:59.999Z`)
        };

        const allowedCompanyUids = await getAllowedCompanyUids(
          app.prisma,
          request.user.sub,
          request.user.role
        );

        const [counts, topCompanies, tripAndIdle, topAlarms] = await Promise.all([
          getDashboardCounts(app.prisma, allowedCompanyUids),
          getTopCompaniesByTransmitting(app.prisma, allowedCompanyUids),
          getTopUnitsByTripAndIdleTime(app.prisma, allowedCompanyUids, range),
          getTopUnitsByAlarms(app.prisma, allowedCompanyUids, range)
        ]);

        return reply.send({
          success: true,
          data: {
            date,
            counts,
            topCompaniesByTransmitting: topCompanies,
            topUnitsByTripTime: tripAndIdle.tripTime,
            topUnitsByIdleTime: tripAndIdle.idleTime,
            topUnitsByTransmittingOff: tripAndIdle.transmittingOff,
            topUnitsByAlarms: topAlarms
          }
        });

      } catch (error) {

        app.log.error(error);

        return reply
          .code(500)
          .send({
            success: false,
            error: "INTERNAL_SERVER_ERROR",
            message: "Error obteniendo el resumen del dashboard"
          });
      }
    }
  );
};

export default dashboardRoutes;
