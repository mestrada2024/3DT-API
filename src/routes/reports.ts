import { FastifyPluginAsync } from "fastify";

import { getDriverEventsReport, listDriverEventTypes } from "../services/driver-events-report.service";
import { getAllowedCompanyUids } from "../services/access-control.service";

interface DriverEventsQuery {
  companyUid?: string;
  from?: string;
  to?: string;
  units?: string;
  eventTypes?: string;
}

/**
 * GET /api/v1/tracking/reports/driver-event-types
 *
 * Catálogo de tipos de evento seleccionables para el reporte de abajo
 * (frenado brusco, aceleración brusca, giro brusco, exceso de
 * velocidad, accidente) — para poblar los checkboxes del frontend.
 */
const reportsRoutes: FastifyPluginAsync = async (app) => {

  app.get(
    "/reports/driver-event-types",
    {
      preHandler: async (request) => {
        await request.jwtVerify();
      }
    },
    async (_request, reply) => {

      const types = await listDriverEventTypes(app.prisma);

      return reply.send({ success: true, data: types });
    }
  );

  /**
   * GET /api/v1/tracking/reports/driver-events
   *
   * Reporte de eventos de conductor (dato real de 3Dtracking, no una
   * aproximación) para una empresa, en un rango de fecha/hora,
   * acotado a unidades y tipos de evento específicos.
   *
   * Parámetros (querystring), todos requeridos:
   * ?companyUid=E1AB3A
   * ?from=2026-09-20T00:00:00Z (ISO 8601)
   * ?to=2026-09-22T23:59:59Z   (ISO 8601)
   * ?units=01264A,D913E9       (externalId separados por coma)
   * ?eventTypes=EXCESSIVE_DECELERATION,OVERSPEEDING (código separados por coma)
   *
   * A diferencia de la primera versión, ya NO hay default implícito
   * de "todas las unidades"/"todos los tipos" cuando se omite el
   * parámetro — el frontend debe enviar la selección explícita (con
   * un botón "seleccionar todas/todos" si el usuario quiere eso),
   * decisión explícita del usuario 2026-09-22.
   *
   * Respeta el mismo control de acceso que el resto de reportes: root
   * ve cualquier empresa, un usuario no-root solo las que tenga
   * asignadas — 403 si pide una empresa fuera de su alcance.
   */
  app.get<{ Querystring: DriverEventsQuery }>(
    "/reports/driver-events",
    {
      preHandler: async (request) => {
        await request.jwtVerify();
      }
    },
    async (request, reply) => {

      const { companyUid, from, to, units, eventTypes } = request.query;

      if (!companyUid || !from || !to || !units || !eventTypes) {
        return reply.code(400).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "companyUid, from, to, units y eventTypes son requeridos"
        });
      }

      const fromDate = new Date(from);
      const toDate = new Date(to);

      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return reply.code(400).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "from/to deben ser fechas ISO 8601 válidas"
        });
      }

      if (fromDate > toDate) {
        return reply.code(400).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "from debe ser anterior a to"
        });
      }

      const unitExternalIds = units.split(",").map((u) => u.trim()).filter((u) => u.length > 0);
      const eventTypeCodes = eventTypes.split(",").map((t) => t.trim()).filter((t) => t.length > 0);

      if (unitExternalIds.length === 0 || eventTypeCodes.length === 0) {
        return reply.code(400).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Selecciona al menos una unidad y un tipo de evento"
        });
      }

      const allowedCompanyUids = await getAllowedCompanyUids(
        app.prisma,
        request.user.sub,
        request.user.role
      );

      if (allowedCompanyUids !== null && !allowedCompanyUids.includes(companyUid)) {
        return reply.code(403).send({
          success: false,
          error: "FORBIDDEN",
          message: "No tiene acceso a esta empresa"
        });
      }

      try {

        const result = await getDriverEventsReport(
          app.prisma,
          app.tracking3d,
          companyUid,
          fromDate,
          toDate,
          unitExternalIds,
          eventTypeCodes
        );

        return reply.send({
          success: true,
          data: result
        });

      } catch (error) {

        app.log.error(error);

        return reply.code(502).send({
          success: false,
          error: "TRACKING3D_ERROR",
          message: "No se pudo generar el reporte contra 3Dtracking"
        });
      }
    }
  );

};

export default reportsRoutes;
