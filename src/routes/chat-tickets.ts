import { FastifyPluginAsync } from "fastify";

import { getAllowedCompanyUids, getUserQueueIds } from "../services/access-control.service";
import { getActorFromRequest, logAction } from "../services/audit-log.service";
import {
  BOT_STATUS_MENU,
  BOT_STATUS_SELF_SERVICE,
  BOT_STATUS_TRANSFERRED,
  handleClientMessage,
  startConversation
} from "../services/chat-bot.service";

interface CreateTicketBody {
  subject?: string;
  description?: string;
  priority?: string;
  companyUid?: string;
  unitUid?: string;
  queueId?: number;
  requesterName?: string;
  requesterPhone?: string;
}

interface UpdateTicketBody {
  status?: string;
  priority?: string;
  queueId?: number | null;
  assignedToUserId?: number | null;
  claim?: boolean;
  release?: boolean;
}

interface TicketIdParams {
  id: string;
}

interface AttachmentParams {
  id: string;
  attachmentId: string;
}

/**
 * Mensajes del hilo con la metadata de sus adjuntos (sin el binario —
 * el archivo se baja aparte por /tickets/:id/attachments/:id).
 */
async function loadThread(prisma: import("@prisma/client").PrismaClient, ticketId: number) {

  const [messages, attachments] = await Promise.all([
    prisma.chatMessage.findMany({ where: { ticketId }, orderBy: { id: "asc" } }),
    prisma.chatAttachment.findMany({
      where: { ticketId },
      select: { id: true, messageId: true, fileName: true, mimeType: true, sizeBytes: true }
    })
  ]);

  return messages.map((message) => ({
    ...message,
    attachments: attachments
      .filter((a) => a.messageId === message.id)
      .map(({ messageId: _messageId, ...rest }) => rest)
  }));
}

interface CreateMessageBody {
  body?: string;
}

interface ListTicketsQuery {
  status?: string;
  queueId?: string;
  view?: string;
}

/**
 * Tickets de soporte — proyecto chatbot Dada Fleet, Fase 1. Modelo de
 * permisos definido con el usuario 2026-10-26:
 *
 * - root/admin (administrador): ve y edita todo.
 * - supervisor: ve/actúa sobre los tickets de las colas a las que
 *   pertenece (UserQueue), sin importar a qué agente estén asignados.
 * - user (agente): por defecto ve los suyos (assignedToUserId=yo);
 *   con ?view=unclaimed ve los sin reclamar de sus colas. Puede
 *   reclamar uno sin reclamar de su cola, o liberar uno propio — no
 *   puede reasignar a otro agente (eso es de supervisor/admin). Para
 *   ver el DETALLE de un ticket puntual (GET /:id) no hay restricción
 *   de cola — cualquier agente puede abrir cualquier ticket para ver
 *   su historial, aunque sea de otro agente (pedido explícito).
 * - cliente: solo sus propios tickets (createdByUserId=yo).
 *
 * Liberación automática a las 24h sin actividad — ver
 * src/plugins/chat-ticket-release-scheduler.ts (usa updatedAt como
 * proxy de "última respuesta": no existe todavía un hilo de mensajes
 * separado, eso es Fase 3).
 */
/**
 * Bug real encontrado 2026-10-26: al reasignar directo (root/admin/
 * supervisor mandan assignedToUserId), solo se actualizaba el id y
 * quedaba el username del agente anterior — se notó al reasignar de
 * un agente a otro, nunca antes porque solo se había probado
 * "quitar asignación" (ambos campos a null a la vez).
 */
async function resolveUsername(
  prisma: import("@prisma/client").PrismaClient,
  userId: number | null
): Promise<string | null> {

  if (userId === null) {
    return null;
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });

  return user?.username ?? null;
}

/**
 * Mismo criterio que GET /tickets/:id — reutilizado por el hilo de
 * mensajes para no duplicar la regla de visibilidad.
 */
async function canViewTicket(
  prisma: import("@prisma/client").PrismaClient,
  ticket: { queueId: number | null; createdByUserId: number | null },
  userId: number,
  role: string
): Promise<boolean> {

  if (role === "root" || role === "admin" || role === "user") {
    return true;
  }

  if (role === "supervisor") {
    const queueIds = await getUserQueueIds(prisma, userId);
    return ticket.queueId !== null && queueIds.includes(ticket.queueId);
  }

  if (role === "cliente") {
    return ticket.createdByUserId === userId;
  }

  return false;
}

const chatTicketsRoutes: FastifyPluginAsync = async (app) => {

  /**
   * POST /api/v1/tickets
   */
  app.post<{
    Body: CreateTicketBody;
  }>(
    "/tickets",
    {
      preHandler: async (request) => {
        await request.jwtVerify();
      }
    },
    async (request, reply) => {

      const actor = getActorFromRequest(request);
      const body = request.body || {};

      if (!body.subject?.trim() || !body.description?.trim()) {
        return reply.code(400).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "subject y description son requeridos"
        });
      }

      try {

        const allowedCompanyUids = await getAllowedCompanyUids(
          app.prisma,
          request.user.sub,
          request.user.role
        );

        const companyUid = body.companyUid?.trim() || null;

        if (companyUid && allowedCompanyUids !== null && !allowedCompanyUids.includes(companyUid)) {
          return reply.code(403).send({
            success: false,
            error: "FORBIDDEN",
            message: "No tenés acceso a esa empresa"
          });
        }

        const created = await app.prisma.chatTicket.create({
          data: {
            subject: body.subject.trim(),
            description: body.description.trim(),
            priority: body.priority?.trim() || "normal",
            companyUid,
            unitUid: body.unitUid?.trim() || null,
            queueId: body.queueId ?? null,
            requesterName: body.requesterName?.trim() || null,
            requesterPhone: body.requesterPhone?.trim() || null,
            createdByUserId: actor.userId,
            createdByUsername: actor.username
          }
        });

        /**
         * La descripción es el primer mensaje del hilo. Si el ticket
         * llega sin cola, el bot saluda y ofrece el menú de colas
         * (ver chat-bot.service.ts); con cola elegida a mano (p. ej.
         * un agente que lo carga por teléfono) el bot no interviene.
         */
        await app.prisma.chatMessage.create({
          data: {
            ticketId: created.id,
            senderType: "cliente",
            senderUserId: actor.userId,
            senderUsername: actor.username,
            body: created.description
          }
        });

        if (created.queueId === null) {
          try {
            await startConversation(app.prisma, app.tracking3d, created);
          } catch (botError) {
            app.log.error(botError, "Chat bot: falló el saludo/respuesta inicial");
          }
        }

        const current = await app.prisma.chatTicket.findUnique({ where: { id: created.id } });

        await logAction(app.prisma, {
          ...actor,
          module: "chat-tickets",
          action: "create",
          resource: String(created.id),
          success: true,
          afterState: current
        });

        return reply.code(201).send({ success: true, data: current });

      } catch (error) {

        app.log.error(error);

        await logAction(app.prisma, {
          ...actor,
          module: "chat-tickets",
          action: "create",
          success: false,
          message: (error as Error).message,
          requestBody: body
        });

        return reply.code(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error creando el ticket"
        });
      }
    }
  );

  /**
   * GET /api/v1/tickets
   *
   * ?view=unclaimed (solo agente) — sin reclamar, de mis colas.
   * ?view=historico — cerrados/resueltos, orden cronológico (más
   * viejo primero, pedido explícito del usuario — distinto del
   * default, que es más reciente primero).
   * Sin ?view: para agente, los míos; para supervisor/admin/root,
   * todo lo que está en su alcance.
   */
  app.get<{
    Querystring: ListTicketsQuery;
  }>(
    "/tickets",
    {
      preHandler: async (request) => {
        await request.jwtVerify();
      }
    },
    async (request, reply) => {

      try {

        const role = request.user.role;
        const userId = request.user.sub;

        const where: {
          status?: string;
          queueId?: number | { in: number[] };
          assignedToUserId?: number | null;
          createdByUserId?: number;
          OR?: Array<Record<string, unknown>>;
        } = {};

        if (request.query.status) {
          where.status = request.query.status.trim();
        }

        if (role === "cliente") {

          where.createdByUserId = userId;

        } else if (role === "supervisor") {

          const queueIds = await getUserQueueIds(app.prisma, userId);
          where.queueId = { in: queueIds };

        } else if (role === "user") {

          const queueIds = await getUserQueueIds(app.prisma, userId);

          if (request.query.view === "unclaimed") {
            where.assignedToUserId = null;
            where.queueId = { in: queueIds };
          } else {
            where.assignedToUserId = userId;
          }
        }
        // root/admin: sin restricción adicional.

        if (request.query.queueId) {
          const queueId = parseInt(request.query.queueId, 10);
          if (!isNaN(queueId)) where.queueId = queueId;
        }

        const historico = request.query.view === "historico";

        const tickets = await app.prisma.chatTicket.findMany({
          where,
          orderBy: { createdAt: historico ? "asc" : "desc" },
          take: 100
        });

        return reply.send({ success: true, data: tickets });

      } catch (error) {

        app.log.error(error);

        return reply.code(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error obteniendo los tickets"
        });
      }
    }
  );

  /**
   * GET /api/v1/tickets/:id
   *
   * 404 tanto si no existe como si está fuera de alcance — mismo
   * criterio que critical-alerts/events/:id. root/admin/agente (user)
   * pueden ver el detalle de CUALQUIER ticket (pedido explícito: un
   * agente necesita poder ver el historial aunque sea de otro
   * agente). supervisor queda acotado a sus colas; cliente, a lo
   * propio.
   */
  app.get<{
    Params: TicketIdParams;
  }>(
    "/tickets/:id",
    {
      preHandler: async (request) => {
        await request.jwtVerify();
      }
    },
    async (request, reply) => {

      try {

        const id = parseInt(request.params.id, 10);

        if (isNaN(id)) {
          return reply.code(400).send({
            success: false,
            error: "INVALID_ID",
            message: "id inválido"
          });
        }

        const ticket = await app.prisma.chatTicket.findUnique({ where: { id } });

        if (!ticket) {
          return reply.code(404).send({
            success: false,
            error: "NOT_FOUND",
            message: "Ticket no encontrado"
          });
        }

        const allowed = await canViewTicket(app.prisma, ticket, request.user.sub, request.user.role);

        if (!allowed) {
          return reply.code(404).send({
            success: false,
            error: "NOT_FOUND",
            message: "Ticket no encontrado"
          });
        }

        return reply.send({ success: true, data: ticket });

      } catch (error) {

        app.log.error(error);

        return reply.code(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error obteniendo el ticket"
        });
      }
    }
  );

  /**
   * PATCH /api/v1/tickets/:id
   *
   * body.claim=true  → el agente se asigna un ticket sin reclamar de
   *   su cola.
   * body.release=true → el agente libera un ticket propio (vuelve a
   *   quedar sin reclamar).
   * assignedToUserId explícito, status, priority, queueId → solo
   *   root/admin/supervisor (supervisor acotado a sus colas).
   */
  app.patch<{
    Params: TicketIdParams;
    Body: UpdateTicketBody;
  }>(
    "/tickets/:id",
    {
      preHandler: async (request) => {
        await request.jwtVerify();
      }
    },
    async (request, reply) => {

      const id = parseInt(request.params.id, 10);

      if (isNaN(id)) {
        return reply.code(400).send({
          success: false,
          error: "INVALID_ID",
          message: "id inválido"
        });
      }

      const actor = getActorFromRequest(request);
      const role = request.user.role;
      const userId = request.user.sub;
      const body = request.body || {};

      try {

        const existing = await app.prisma.chatTicket.findUnique({ where: { id } });

        if (!existing) {
          return reply.code(404).send({
            success: false,
            error: "NOT_FOUND",
            message: "Ticket no encontrado"
          });
        }

        const data: {
          status?: string;
          priority?: string;
          queueId?: number | null;
          assignedToUserId?: number | null;
          assignedToUsername?: string | null;
        } = {};

        if (role === "root" || role === "admin") {

          if (body.status !== undefined) data.status = body.status;
          if (body.priority !== undefined) data.priority = body.priority;
          if (body.queueId !== undefined) data.queueId = body.queueId;

          if (body.assignedToUserId !== undefined) {
            data.assignedToUserId = body.assignedToUserId;
            data.assignedToUsername = await resolveUsername(app.prisma, body.assignedToUserId);
          }

        } else if (role === "supervisor") {

          const queueIds = await getUserQueueIds(app.prisma, userId);

          if (existing.queueId === null || !queueIds.includes(existing.queueId)) {
            return reply.code(403).send({
              success: false,
              error: "FORBIDDEN",
              message: "Ese ticket no pertenece a una cola que supervisás"
            });
          }

          if (body.status !== undefined) data.status = body.status;
          if (body.priority !== undefined) data.priority = body.priority;

          if (body.assignedToUserId !== undefined) {
            data.assignedToUserId = body.assignedToUserId;
            data.assignedToUsername = await resolveUsername(app.prisma, body.assignedToUserId);
          }

        } else if (role === "user") {

          if (body.claim) {

            const queueIds = await getUserQueueIds(app.prisma, userId);

            if (existing.assignedToUserId !== null) {
              return reply.code(409).send({
                success: false,
                error: "ALREADY_CLAIMED",
                message: "Este ticket ya fue reclamado"
              });
            }

            if (existing.queueId === null || !queueIds.includes(existing.queueId)) {
              return reply.code(403).send({
                success: false,
                error: "FORBIDDEN",
                message: "Ese ticket no pertenece a una de tus colas"
              });
            }

            data.assignedToUserId = userId;
            data.assignedToUsername = actor.username;

          } else if (body.release) {

            if (existing.assignedToUserId !== userId) {
              return reply.code(403).send({
                success: false,
                error: "FORBIDDEN",
                message: "Solo podés liberar un ticket asignado a vos"
              });
            }

            data.assignedToUserId = null;
            data.assignedToUsername = null;

          } else if (body.status !== undefined && existing.assignedToUserId === userId) {

            data.status = body.status;

          } else if (body.status !== undefined && existing.assignedToUserId === null) {

            /**
             * Auto-reclamo: el agente responde (cambia status) un
             * ticket sin reclamar de su cola sin tener que tocar
             * primero "Reclamar" — pedido explícito del usuario
             * 2026-10-26. El botón "Reclamar" explícito sigue
             * existiendo para cuando solo quiere tomarlo sin
             * responder todavía.
             */
            const queueIds = await getUserQueueIds(app.prisma, userId);

            if (existing.queueId === null || !queueIds.includes(existing.queueId)) {
              return reply.code(403).send({
                success: false,
                error: "FORBIDDEN",
                message: "Ese ticket no pertenece a una de tus colas"
              });
            }

            data.assignedToUserId = userId;
            data.assignedToUsername = actor.username;
            data.status = body.status;

          } else {

            return reply.code(403).send({
              success: false,
              error: "FORBIDDEN",
              message: "Este ticket no está asignado a vos"
            });
          }

        } else {

          return reply.code(403).send({
            success: false,
            error: "FORBIDDEN",
            message: "Tu rol no puede modificar tickets"
          });
        }

        if (Object.keys(data).length === 0) {
          return reply.code(400).send({
            success: false,
            error: "VALIDATION_ERROR",
            message: "No hay cambios para aplicar"
          });
        }

        const updated = await app.prisma.chatTicket.update({ where: { id }, data });

        await logAction(app.prisma, {
          ...actor,
          module: "chat-tickets",
          action: "update",
          resource: String(id),
          success: true,
          beforeState: existing,
          afterState: updated
        });

        return reply.send({ success: true, data: updated });

      } catch (error) {

        app.log.error(error);

        return reply.code(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error actualizando el ticket"
        });
      }
    }
  );

  /**
   * GET /api/v1/tickets/:id/messages
   *
   * Hilo del ticket, más viejo primero. Misma visibilidad que el
   * detalle (404 si está fuera de alcance).
   */
  app.get<{
    Params: TicketIdParams;
  }>(
    "/tickets/:id/messages",
    {
      preHandler: async (request) => {
        await request.jwtVerify();
      }
    },
    async (request, reply) => {

      const id = parseInt(request.params.id, 10);

      if (isNaN(id)) {
        return reply.code(400).send({
          success: false,
          error: "INVALID_ID",
          message: "id inválido"
        });
      }

      try {

        const ticket = await app.prisma.chatTicket.findUnique({ where: { id } });

        if (!ticket || !(await canViewTicket(app.prisma, ticket, request.user.sub, request.user.role))) {
          return reply.code(404).send({
            success: false,
            error: "NOT_FOUND",
            message: "Ticket no encontrado"
          });
        }

        const messages = await loadThread(app.prisma, id);

        return reply.send({ success: true, data: messages });

      } catch (error) {

        app.log.error(error);

        return reply.code(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error obteniendo los mensajes"
        });
      }
    }
  );

  /**
   * POST /api/v1/tickets/:id/messages
   *
   * Quien creó el ticket escribe como "cliente" — mientras el bot
   * esté en el menú, su mensaje se interpreta como la opción elegida.
   * Cualquier otro usuario escribe como "agente", con las mismas
   * reglas que PATCH: root/admin cualquiera; supervisor, sus colas;
   * agente, lo asignado a él o lo sin reclamar de sus colas (en ese
   * caso se lo reclama, igual que el auto-reclamo al cambiar estado).
   * Si un agente escribe mientras el bot está activo, el bot se
   * detiene. Solo los mensajes de agente actualizan updatedAt del
   * ticket (es la "última respuesta" que mira la liberación a 24h).
   */
  app.post<{
    Params: TicketIdParams;
    Body: CreateMessageBody;
  }>(
    "/tickets/:id/messages",
    {
      preHandler: async (request) => {
        await request.jwtVerify();
      }
    },
    async (request, reply) => {

      const id = parseInt(request.params.id, 10);

      if (isNaN(id)) {
        return reply.code(400).send({
          success: false,
          error: "INVALID_ID",
          message: "id inválido"
        });
      }

      const text = request.body?.body?.trim();

      if (!text) {
        return reply.code(400).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "body es requerido"
        });
      }

      const actor = getActorFromRequest(request);
      const role = request.user.role;
      const userId = request.user.sub;

      try {

        const ticket = await app.prisma.chatTicket.findUnique({ where: { id } });

        if (!ticket || !(await canViewTicket(app.prisma, ticket, userId, role))) {
          return reply.code(404).send({
            success: false,
            error: "NOT_FOUND",
            message: "Ticket no encontrado"
          });
        }

        if (ticket.status === "cerrado") {
          return reply.code(409).send({
            success: false,
            error: "TICKET_CLOSED",
            message: "El ticket está cerrado"
          });
        }

        if (ticket.createdByUserId === userId) {

          await app.prisma.chatMessage.create({
            data: {
              ticketId: id,
              senderType: "cliente",
              senderUserId: actor.userId,
              senderUsername: actor.username,
              body: text
            }
          });

          /**
           * Si el bot falla (ej. al armar un PDF), el mensaje del
           * cliente ya quedó guardado y el bot ya avisó en el hilo —
           * se loguea y se devuelve el hilo igual, en vez de un 500.
           */
          try {
            await handleClientMessage(app.prisma, app.tracking3d, ticket, text);
          } catch (botError) {
            app.log.error(botError, "Chat bot: falló la respuesta automática");
          }

        } else {

          const data: {
            updatedAt: Date;
            botStatus?: string;
            queueId?: number;
            assignedToUserId?: number;
            assignedToUsername?: string | null;
          } = { updatedAt: new Date() };

          if (role === "supervisor") {

            const queueIds = await getUserQueueIds(app.prisma, userId);

            if (ticket.queueId === null || !queueIds.includes(ticket.queueId)) {
              return reply.code(403).send({
                success: false,
                error: "FORBIDDEN",
                message: "Ese ticket no pertenece a una cola que supervisás"
              });
            }

          } else if (role === "user") {

            if (ticket.assignedToUserId === null) {

              const queueIds = await getUserQueueIds(app.prisma, userId);

              if (ticket.queueId === null || !queueIds.includes(ticket.queueId)) {
                return reply.code(403).send({
                  success: false,
                  error: "FORBIDDEN",
                  message: "Ese ticket no pertenece a una de tus colas"
                });
              }

              data.assignedToUserId = userId;
              data.assignedToUsername = actor.username;

            } else if (ticket.assignedToUserId !== userId) {

              return reply.code(403).send({
                success: false,
                error: "FORBIDDEN",
                message: "Este ticket no está asignado a vos"
              });
            }

          } else if (role !== "root" && role !== "admin") {

            return reply.code(403).send({
              success: false,
              error: "FORBIDDEN",
              message: "Tu rol no puede responder este ticket"
            });
          }

          /**
           * Si un agente (o root/admin) responde mientras el bot todavía
           * atiende, el bot se detiene; si el cliente ya había elegido
           * una cola (modo consulta), el ticket entra a esa cola.
           */
          if (ticket.botStatus === BOT_STATUS_MENU || ticket.botStatus === BOT_STATUS_SELF_SERVICE) {
            data.botStatus = BOT_STATUS_TRANSFERRED;
          }

          if (ticket.botStatus === BOT_STATUS_SELF_SERVICE && ticket.queueId === null && ticket.botMenuQueueId !== null) {
            data.queueId = ticket.botMenuQueueId;
          }

          await app.prisma.chatMessage.create({
            data: {
              ticketId: id,
              senderType: "agente",
              senderUserId: actor.userId,
              senderUsername: actor.username,
              body: text
            }
          });

          await app.prisma.chatTicket.update({ where: { id }, data });
        }

        const [updatedTicket, messages] = await Promise.all([
          app.prisma.chatTicket.findUnique({ where: { id } }),
          loadThread(app.prisma, id)
        ]);

        return reply.code(201).send({ success: true, data: { ticket: updatedTicket, messages } });

      } catch (error) {

        app.log.error(error);

        return reply.code(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error enviando el mensaje"
        });
      }
    }
  );

  /**
   * GET /api/v1/tickets/:id/attachments/:attachmentId
   *
   * Descarga un adjunto (ej. reporte PDF del bot). Misma visibilidad
   * que el ticket; 404 si no existe, no es de ese ticket o el ticket
   * está fuera de alcance.
   */
  app.get<{
    Params: AttachmentParams;
  }>(
    "/tickets/:id/attachments/:attachmentId",
    {
      preHandler: async (request) => {
        await request.jwtVerify();
      }
    },
    async (request, reply) => {

      const id = parseInt(request.params.id, 10);
      const attachmentId = parseInt(request.params.attachmentId, 10);

      if (isNaN(id) || isNaN(attachmentId)) {
        return reply.code(400).send({
          success: false,
          error: "INVALID_ID",
          message: "id inválido"
        });
      }

      try {

        const ticket = await app.prisma.chatTicket.findUnique({ where: { id } });

        const attachment = ticket && (await canViewTicket(app.prisma, ticket, request.user.sub, request.user.role))
          ? await app.prisma.chatAttachment.findFirst({ where: { id: attachmentId, ticketId: id } })
          : null;

        if (!attachment) {
          return reply.code(404).send({
            success: false,
            error: "NOT_FOUND",
            message: "Archivo no encontrado"
          });
        }

        return reply
          .header("Content-Type", attachment.mimeType)
          .header("Content-Length", attachment.sizeBytes)
          .header("Content-Disposition", `attachment; filename="${attachment.fileName.replace(/"/g, "")}"`)
          .send(Buffer.from(attachment.data));

      } catch (error) {

        app.log.error(error);

        return reply.code(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error descargando el archivo"
        });
      }
    }
  );

};

export default chatTicketsRoutes;
