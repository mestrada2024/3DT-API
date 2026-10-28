import { FastifyPluginAsync } from "fastify";

import { getAllowedCompanyUids } from "../services/access-control.service";
import { getActorFromRequest, logAction } from "../services/audit-log.service";
import { createLiveShareLink, getPublicLiveData } from "../services/live-share.service";

interface CreateLinkBody {
  unitUid?: string;
  minutes?: number;
}

interface LinkIdParams {
  id: string;
}

interface TokenParams {
  token: string;
}

interface PublicLiveQuery {
  since?: string;
}

/**
 * Links efímeros de seguimiento en vivo — ver live-share.service.ts.
 * Crear/revocar requiere sesión; la consulta pública
 * (/public/live/:token) no, y tiene su propio límite por token: la
 * página consulta cada 10s (6/min), 60/min alcanza para ~10 visores
 * del mismo link sin tocar el límite global de la API.
 */
const liveShareRoutes: FastifyPluginAsync = async (app) => {

  /**
   * POST /api/v1/live-links  { unitUid, minutes? }
   */
  app.post<{
    Body: CreateLinkBody;
  }>(
    "/live-links",
    {
      preHandler: async (request) => {
        await request.jwtVerify();
      }
    },
    async (request, reply) => {

      const actor = getActorFromRequest(request);
      const unitUid = request.body?.unitUid?.trim();

      if (!unitUid) {
        return reply.code(400).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "unitUid es requerido"
        });
      }

      try {

        const unit = await app.prisma.unit.findUnique({
          where: { externalId: unitUid },
          select: { id: true, companyUid: true, name: true }
        });

        const allowed = await getAllowedCompanyUids(app.prisma, request.user.sub, request.user.role);

        if (!unit || (allowed !== null && (!unit.companyUid || !allowed.includes(unit.companyUid)))) {
          return reply.code(404).send({
            success: false,
            error: "NOT_FOUND",
            message: "Unidad no encontrada"
          });
        }

        const link = await createLiveShareLink(app.prisma, {
          unitId: unit.id,
          minutes: request.body?.minutes,
          createdByUserId: actor.userId ?? null,
          createdByUsername: actor.username ?? null
        });

        await logAction(app.prisma, {
          ...actor,
          module: "live-links",
          action: "create",
          resource: String(link.id),
          success: true,
          afterState: { unitUid, unitName: unit.name, expiresAt: link.expiresAt }
        });

        return reply.code(201).send({
          success: true,
          data: { id: link.id, url: link.url, expiresAt: link.expiresAt, minutes: link.minutes }
        });

      } catch (error) {

        app.log.error(error);

        return reply.code(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error creando el link"
        });
      }
    }
  );

  /**
   * POST /api/v1/live-links/:id/revoke — quien lo creó, o root/admin.
   */
  app.post<{
    Params: LinkIdParams;
  }>(
    "/live-links/:id/revoke",
    {
      preHandler: async (request) => {
        await request.jwtVerify();
      }
    },
    async (request, reply) => {

      const id = parseInt(request.params.id, 10);
      const actor = getActorFromRequest(request);
      const role = request.user.role;

      try {

        const link = isNaN(id) ? null : await app.prisma.liveShareLink.findUnique({ where: { id } });

        if (!link || (role !== "root" && role !== "admin" && link.createdByUserId !== request.user.sub)) {
          return reply.code(404).send({
            success: false,
            error: "NOT_FOUND",
            message: "Link no encontrado"
          });
        }

        const updated = await app.prisma.liveShareLink.update({
          where: { id },
          data: { revokedAt: link.revokedAt ?? new Date() }
        });

        await logAction(app.prisma, {
          ...actor,
          module: "live-links",
          action: "revoke",
          resource: String(id),
          success: true
        });

        return reply.send({ success: true, data: { id: updated.id, revokedAt: updated.revokedAt } });

      } catch (error) {

        app.log.error(error);

        return reply.code(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error revocando el link"
        });
      }
    }
  );

  /**
   * GET /api/v1/public/live/:token?since=<epoch ms>
   *
   * SIN autenticación — el token es el secreto. 404 si no existe, 410
   * si venció o fue revocado (la página muestra "link vencido").
   */
  app.get<{
    Params: TokenParams;
    Querystring: PublicLiveQuery;
  }>(
    "/public/live/:token",
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: "1 minute",
          keyGenerator: (request: { params: unknown }) => `live:${(request.params as TokenParams).token}`
        }
      }
    },
    async (request, reply) => {

      const token = request.params.token;

      if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
        return reply.code(404).send({ success: false, error: "NOT_FOUND", message: "Link no encontrado" });
      }

      const sinceRaw = request.query.since ? Number(request.query.since) : null;
      const since = sinceRaw !== null && Number.isFinite(sinceRaw) ? sinceRaw : null;

      try {

        const result = await getPublicLiveData(app.prisma, token, since);

        reply.header("Cache-Control", "no-store");

        if (result.status === "not_found") {
          return reply.code(404).send({ success: false, error: "NOT_FOUND", message: "Link no encontrado" });
        }

        if (result.status === "expired") {
          return reply.code(410).send({ success: false, error: "LINK_EXPIRED", message: "Este link de seguimiento ya venció" });
        }

        return reply.send({ success: true, data: result.data });

      } catch (error) {

        app.log.error(error);

        return reply.code(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error obteniendo la ubicación"
        });
      }
    }
  );

};

export default liveShareRoutes;
