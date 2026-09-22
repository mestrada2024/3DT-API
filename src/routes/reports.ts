import { FastifyPluginAsync } from "fastify";

import { getHarshBrakingReport } from "../services/harsh-braking-report.service";
import { getAllowedCompanyUids } from "../services/access-control.service";

interface HarshBrakingQuery {
  companyUid?: string;
  from?: string;
  to?: string;
  units?: string;
}

/**
 * GET /api/v1/tracking/reports/harsh-braking
 *
 * Reporte de frenado brusco (dato real de 3Dtracking, no una
 * aproximación) para una empresa, en un rango de fecha/hora,
 * opcionalmente acotado a unidades específicas — si no se envían
 * unidades, se usan todas las de la empresa.
 *
 * Parámetros (querystring):
 * ?companyUid=E1AB3A        (requerido)
 * ?from=2026-09-20T00:00:00Z (requerido, ISO 8601)
 * ?to=2026-09-22T23:59:59Z   (requerido, ISO 8601)
 * ?units=01264A,D913E9       (opcional, externalId separados por coma)
 *
 * Respeta el mismo control de acceso que el resto de reportes: root
 * ve cualquier empresa, un usuario no-root solo las que tenga
 * asignadas (ver access-control.service.ts) — 403 si pide una
 * empresa fuera de su alcance.
 *
 * Puede tardar varios minutos en rangos de varios días (ver
 * harsh-braking-report.service.ts) — el resultado incluye
 * `truncated: true` si no se pudo completar todo el rango pedido
 * (límite de páginas o límite de tasa de 3Dtracking), en vez de
 * fallar todo el reporte.
 */
const harshBrakingReportRoutes: FastifyPluginAsync = async (app) => {

  app.get<{ Querystring: HarshBrakingQuery }>(
    "/reports/harsh-braking",
    {
      preHandler: async (request) => {
        await request.jwtVerify();
      }
    },
    async (request, reply) => {

      const { companyUid, from, to, units } = request.query;

      if (!companyUid || !from || !to) {
        return reply.code(400).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "companyUid, from y to son requeridos"
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

      const unitExternalIds = units
        ? units.split(",").map((u) => u.trim()).filter((u) => u.length > 0)
        : undefined;

      try {

        const result = await getHarshBrakingReport(
          app.prisma,
          app.tracking3d,
          companyUid,
          fromDate,
          toDate,
          unitExternalIds
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

export default harshBrakingReportRoutes;
