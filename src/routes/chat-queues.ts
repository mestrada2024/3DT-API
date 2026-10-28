import { FastifyPluginAsync } from "fastify";

import { getUserQueueIds, requireRoot } from "../services/access-control.service";
import { getActorFromRequest, logAction } from "../services/audit-log.service";

interface CreateQueueBody {
  name?: string;
  description?: string | null;
  kind?: string;
  destination?: string;
  parentId?: number | null;
  sortOrder?: number;
  active?: boolean;
}

interface BotConfigBody {
  greeting?: string;
  invalidOption?: string;
  transferMessage?: string;
}

const QUEUE_KINDS = ["principal", "secundaria"];
const QUEUE_DESTINATIONS = ["cola", "agentes"];

/**
 * Reglas del menú del bot (ver chat-bot.service.ts): una principal no
 * tiene padre; una secundaria necesita un padre con destino "cola"
 * (es la que la muestra como subopción) y no puede colgar de sí
 * misma ni de una descendiente. Devuelve el mensaje de error o null.
 */
async function validateQueueConfig(
  prisma: import("@prisma/client").PrismaClient,
  config: { kind: string; destination: string; parentId: number | null },
  selfId: number | null
): Promise<string | null> {

  if (!QUEUE_KINDS.includes(config.kind)) {
    return "kind debe ser principal o secundaria";
  }

  if (!QUEUE_DESTINATIONS.includes(config.destination)) {
    return "destination debe ser cola o agentes";
  }

  if (config.kind === "principal") {
    return null;
  }

  if (config.parentId === null) {
    return "Una cola secundaria necesita una cola padre";
  }

  const visited = new Set<number>();
  let currentId: number | null = config.parentId;

  while (currentId !== null) {

    if (currentId === selfId) {
      return "La cola padre no puede ser la misma cola ni una de sus secundarias";
    }

    if (visited.has(currentId)) {
      break;
    }

    visited.add(currentId);

    const current: { parentId: number | null; destination: string } | null =
      await prisma.chatQueue.findUnique({
        where: { id: currentId },
        select: { parentId: true, destination: true }
      });

    if (!current) {
      return "La cola padre no existe";
    }

    if (currentId === config.parentId && current.destination !== "cola") {
      return "La cola padre debe tener destino \"cola\"";
    }

    currentId = current.parentId;
  }

  return null;
}

interface QueueIdParams {
  id: string;
}

/**
 * Colas de soporte ("grupos de usuarios") — administración solo
 * root, ver ChatQueue/UserQueue en el schema. La asignación de
 * usuarios a colas se hace desde PATCH /api/v1/admin/users/:id
 * (campo queueIds), mismo patrón que companyUids.
 */
const chatQueuesRoutes: FastifyPluginAsync = async (app) => {

  /**
   * GET /api/v1/chat-queues
   *
   * Cualquier usuario autenticado puede listarlas (para elegir cola
   * al crear un ticket, por ejemplo) — crear/editar queda root.
   */
  app.get(
    "/chat-queues",
    {
      preHandler: async (request) => {
        await request.jwtVerify();
      }
    },
    async (request, reply) => {

      try {

        const queues = await app.prisma.chatQueue.findMany({
          orderBy: { name: "asc" }
        });

        return reply.send({ success: true, data: queues });

      } catch (error) {

        app.log.error(error);

        return reply.code(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error obteniendo las colas"
        });
      }
    }
  );

  /**
   * GET /api/v1/chat-queues/:id/agents
   *
   * Agentes (rol "user") activos asignados a esa cola — para poblar
   * el selector de reasignación de tickets. root/admin pueden
   * consultar cualquier cola; supervisor solo las suyas (pedido
   * explícito del usuario 2026-10-26: "un supervisor... lo puede
   * reasignar a otro agente").
   */
  app.get<{
    Params: QueueIdParams;
  }>(
    "/chat-queues/:id/agents",
    {
      preHandler: async (request) => {
        await request.jwtVerify();
      }
    },
    async (request, reply) => {

      const queueId = parseInt(request.params.id, 10);

      if (isNaN(queueId)) {
        return reply.code(400).send({
          success: false,
          error: "INVALID_ID",
          message: "id inválido"
        });
      }

      const role = request.user.role;

      if (role === "supervisor") {

        const queueIds = await getUserQueueIds(app.prisma, request.user.sub);

        if (!queueIds.includes(queueId)) {
          return reply.code(403).send({
            success: false,
            error: "FORBIDDEN",
            message: "Esa cola no está entre las que supervisás"
          });
        }

      } else if (role !== "root" && role !== "admin") {

        return reply.code(403).send({
          success: false,
          error: "FORBIDDEN",
          message: "Tu rol no puede consultar los agentes de una cola"
        });
      }

      try {

        const memberships = await app.prisma.userQueue.findMany({
          where: { queueId },
          select: { userId: true }
        });

        const userIds = memberships.map((m) => m.userId);

        const agents = userIds.length
          ? await app.prisma.user.findMany({
              where: { id: { in: userIds }, role: "user", active: true },
              select: { id: true, username: true },
              orderBy: { username: "asc" }
            })
          : [];

        return reply.send({ success: true, data: agents });

      } catch (error) {

        app.log.error(error);

        return reply.code(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error obteniendo los agentes de la cola"
        });
      }
    }
  );

  /**
   * POST /api/v1/chat-queues
   */
  app.post<{
    Body: CreateQueueBody;
  }>(
    "/chat-queues",
    {
      preHandler: async (request, reply) => {
        await request.jwtVerify();
        await requireRoot(request, reply);
      }
    },
    async (request, reply) => {

      const actor = getActorFromRequest(request);
      const body = request.body || {};
      const name = body.name?.trim();

      if (!name) {
        return reply.code(400).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "name es requerido"
        });
      }

      const kind = body.kind ?? "principal";
      const destination = body.destination ?? "agentes";
      const parentId = kind === "principal" ? null : body.parentId ?? null;

      try {

        const validationError = await validateQueueConfig(
          app.prisma,
          { kind, destination, parentId },
          null
        );

        if (validationError) {
          return reply.code(400).send({
            success: false,
            error: "VALIDATION_ERROR",
            message: validationError
          });
        }

        const created = await app.prisma.chatQueue.create({
          data: {
            name,
            description: body.description?.trim() || null,
            kind,
            destination,
            parentId,
            sortOrder: body.sortOrder ?? 0,
            active: body.active ?? true
          }
        });

        await logAction(app.prisma, {
          ...actor,
          module: "chat-queues",
          action: "create",
          resource: String(created.id),
          success: true,
          afterState: created
        });

        return reply.code(201).send({ success: true, data: created });

      } catch (error: any) {

        if (error?.code === "P2002") {
          return reply.code(409).send({
            success: false,
            error: "QUEUE_ALREADY_EXISTS",
            message: "Ya existe una cola con ese nombre"
          });
        }

        app.log.error(error);

        return reply.code(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error creando la cola"
        });
      }
    }
  );

  /**
   * PATCH /api/v1/chat-queues/:id
   *
   * Mismos campos que el alta. No se puede pasar a destino "agentes"
   * una cola que todavía tiene secundarias colgando (quedarían
   * inalcanzables en el menú) — primero hay que moverlas.
   */
  app.patch<{
    Params: QueueIdParams;
    Body: CreateQueueBody;
  }>(
    "/chat-queues/:id",
    {
      preHandler: async (request, reply) => {
        await request.jwtVerify();
        await requireRoot(request, reply);
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
      const body = request.body || {};

      try {

        const existing = await app.prisma.chatQueue.findUnique({ where: { id } });

        if (!existing) {
          return reply.code(404).send({
            success: false,
            error: "NOT_FOUND",
            message: "Cola no encontrada"
          });
        }

        if (body.name !== undefined && !body.name.trim()) {
          return reply.code(400).send({
            success: false,
            error: "VALIDATION_ERROR",
            message: "name no puede quedar vacío"
          });
        }

        const kind = body.kind ?? existing.kind;
        const destination = body.destination ?? existing.destination;
        const parentId = kind === "principal"
          ? null
          : body.parentId !== undefined ? body.parentId : existing.parentId;

        const validationError = await validateQueueConfig(
          app.prisma,
          { kind, destination, parentId },
          id
        );

        if (validationError) {
          return reply.code(400).send({
            success: false,
            error: "VALIDATION_ERROR",
            message: validationError
          });
        }

        if (destination !== "cola") {

          const childCount = await app.prisma.chatQueue.count({ where: { parentId: id } });

          if (childCount > 0) {
            return reply.code(409).send({
              success: false,
              error: "QUEUE_HAS_CHILDREN",
              message: `Esta cola tiene ${childCount} cola(s) secundaria(s); movelas antes de cambiar el destino a agentes`
            });
          }
        }

        const updated = await app.prisma.chatQueue.update({
          where: { id },
          data: {
            name: body.name !== undefined ? body.name.trim() : undefined,
            description: body.description !== undefined ? body.description?.trim() || null : undefined,
            kind,
            destination,
            parentId,
            sortOrder: body.sortOrder,
            active: body.active
          }
        });

        await logAction(app.prisma, {
          ...actor,
          module: "chat-queues",
          action: "update",
          resource: String(id),
          success: true,
          beforeState: existing,
          afterState: updated
        });

        return reply.send({ success: true, data: updated });

      } catch (error: any) {

        if (error?.code === "P2002") {
          return reply.code(409).send({
            success: false,
            error: "QUEUE_ALREADY_EXISTS",
            message: "Ya existe una cola con ese nombre"
          });
        }

        app.log.error(error);

        return reply.code(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error actualizando la cola"
        });
      }
    }
  );

  /**
   * GET /api/v1/chat-bot/config — textos fijos del bot (saludo,
   * opción inválida, transferencia). Solo root, igual que las colas.
   */
  app.get(
    "/chat-bot/config",
    {
      preHandler: async (request, reply) => {
        await request.jwtVerify();
        await requireRoot(request, reply);
      }
    },
    async (request, reply) => {

      try {

        const config = await app.prisma.chatBotConfig.findUnique({ where: { id: 1 } });

        return reply.send({ success: true, data: config });

      } catch (error) {

        app.log.error(error);

        return reply.code(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error obteniendo la configuración del bot"
        });
      }
    }
  );

  /**
   * PUT /api/v1/chat-bot/config
   */
  app.put<{
    Body: BotConfigBody;
  }>(
    "/chat-bot/config",
    {
      preHandler: async (request, reply) => {
        await request.jwtVerify();
        await requireRoot(request, reply);
      }
    },
    async (request, reply) => {

      const actor = getActorFromRequest(request);
      const body = request.body || {};

      const greeting = body.greeting?.trim();
      const invalidOption = body.invalidOption?.trim();
      const transferMessage = body.transferMessage?.trim();

      if (!greeting || !invalidOption || !transferMessage) {
        return reply.code(400).send({
          success: false,
          error: "VALIDATION_ERROR",
          message: "greeting, invalidOption y transferMessage son requeridos"
        });
      }

      try {

        const before = await app.prisma.chatBotConfig.findUnique({ where: { id: 1 } });

        const saved = await app.prisma.chatBotConfig.upsert({
          where: { id: 1 },
          create: { id: 1, greeting, invalidOption, transferMessage },
          update: { greeting, invalidOption, transferMessage }
        });

        await logAction(app.prisma, {
          ...actor,
          module: "chat-bot",
          action: "update-config",
          resource: "1",
          success: true,
          beforeState: before,
          afterState: saved
        });

        return reply.send({ success: true, data: saved });

      } catch (error) {

        app.log.error(error);

        return reply.code(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error guardando la configuración del bot"
        });
      }
    }
  );

};

export default chatQueuesRoutes;
