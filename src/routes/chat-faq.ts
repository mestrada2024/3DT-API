import { FastifyPluginAsync } from "fastify";

import { requireWrite } from "../services/access-control.service";
import { getActorFromRequest, logAction } from "../services/audit-log.service";

interface ListFaqQuery {
  search?: string;
  category?: string;
  active?: string;
}

interface CreateFaqBody {
  question?: string;
  answer?: string;
  category?: string;
  active?: boolean;
}

/**
 * Preguntas frecuentes — proyecto chatbot Dada Fleet (spec v1.0,
 * 2026-10-26), Fase 1. Consulta abierta a cualquier usuario
 * autenticado (RF-08) EXCEPTO el rol cliente (pedido explícito
 * 2026-10-26: "en el perfil cliente, quitar el permiso para poder ver
 * FAQ"); administración (crear) solo root/admin, como pide el
 * documento ("solo para roles autorizados").
 */
const chatFaqRoutes: FastifyPluginAsync = async (app) => {

  /**
   * GET /api/v1/faq
   *
   * Por defecto solo las activas — ?active=false para ver también
   * las desactivadas (uso administrativo).
   */
  app.get<{
    Querystring: ListFaqQuery;
  }>(
    "/faq",
    {
      preHandler: async (request, reply) => {
        await request.jwtVerify();

        if (request.user.role === "cliente") {
          reply.code(403).send({
            success: false,
            error: "FORBIDDEN",
            message: "Tu rol no tiene acceso a las preguntas frecuentes"
          });
        }
      }
    },
    async (request, reply) => {

      try {

        const where: {
          active?: boolean;
          category?: string;
          OR?: Array<{ question?: { contains: string }; answer?: { contains: string } }>;
        } = {};

        if (request.query.active === "false") {
          where.active = false;
        } else if (request.query.active !== "all") {
          where.active = true;
        }

        if (request.query.category) {
          where.category = request.query.category.trim();
        }

        if (request.query.search) {
          const search = request.query.search.trim();

          if (search) {
            where.OR = [
              { question: { contains: search } },
              { answer: { contains: search } }
            ];
          }
        }

        const faqs = await app.prisma.chatFaq.findMany({
          where,
          orderBy: { id: "asc" }
        });

        return reply.send({ success: true, data: faqs });

      } catch (error) {

        app.log.error(error);

        return reply.code(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error obteniendo las preguntas frecuentes"
        });
      }
    }
  );

  /**
   * POST /api/v1/faq
   */
  app.post<{
    Body: CreateFaqBody;
  }>(
    "/faq",
    {
      preHandler: async (request, reply) => {
        await request.jwtVerify();
        await requireWrite(request, reply);
      }
    },
    async (request, reply) => {

      const actor = getActorFromRequest(request);
      const body = request.body || {};

      if (!body.question?.trim() || !body.answer?.trim()) {
        return reply.code(400).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "question y answer son requeridos"
        });
      }

      try {

        const created = await app.prisma.chatFaq.create({
          data: {
            question: body.question.trim(),
            answer: body.answer.trim(),
            category: body.category?.trim() || null,
            active: body.active ?? true
          }
        });

        await logAction(app.prisma, {
          ...actor,
          module: "chat-faq",
          action: "create",
          resource: String(created.id),
          success: true,
          afterState: created
        });

        return reply.code(201).send({ success: true, data: created });

      } catch (error) {

        app.log.error(error);

        await logAction(app.prisma, {
          ...actor,
          module: "chat-faq",
          action: "create",
          success: false,
          message: (error as Error).message,
          requestBody: body
        });

        return reply.code(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error creando la pregunta frecuente"
        });
      }
    }
  );

};

export default chatFaqRoutes;
