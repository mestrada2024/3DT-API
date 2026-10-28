import { FastifyPluginAsync } from "fastify";
import bcrypt from "bcrypt";

import { requireRoot } from "../services/access-control.service";
import { logAction, getActorFromRequest } from "../services/audit-log.service";

interface UserIdParams {
  id: string;
}

interface CreateUserBody {
  username?: string;
  password?: string;
  role?: string;
  whatsapp?: string;
  companyUids?: string[];
  queueIds?: number[];
}

interface UpdateUserBody {
  password?: string;
  role?: string;
  whatsapp?: string;
  active?: boolean;
  companyUids?: string[];
  queueIds?: number[];
}

/**
 * Taxonomía definida 2026-10-26 (proyecto chatbot Dada Fleet):
 * root (sin cambios) | admin = administrador | supervisor (nuevo) |
 * user = agente | cliente (nuevo, perfil externo).
 *
 * WhatsApp obligatorio SOLO para "cliente" (corregido 2026-10-26 —
 * primera versión lo pedía al revés): es la clave con la que un
 * mensaje entrante, de WhatsApp o del chat web interno, se vincula a
 * su cuenta. admin/supervisor/agente/root se identifican con
 * usuario/clave, no lo necesitan.
 */
const VALID_ROLES = ["root", "admin", "supervisor", "user", "cliente"];
const WHATSAPP_REQUIRED_ROLES = ["cliente"];

/**
 * Administración de usuarios — solo rol root (ver
 * access-control.service.ts). Cada usuario puede tener N empresas
 * asignadas (UserCompany), que determinan qué ve en Vehículos/SIMs/
 * GPS/Empresas si su rol no es root.
 */
const usersRoutes: FastifyPluginAsync = async (app) => {

  /**
   * GET /api/v1/admin/users
   */
  app.get(
    "/users",
    {
      preHandler: async (request, reply) => {
        await request.jwtVerify();
        await requireRoot(request, reply);
      }
    },
    async (request, reply) => {

      try {

        const users = await app.prisma.user.findMany({
          orderBy: { username: "asc" },
          select: {
            id: true,
            username: true,
            role: true,
            whatsapp: true,
            active: true,
            createdAt: true
          }
        });

        const assignments = await app.prisma.userCompany.findMany({
          select: { userId: true, companyUid: true }
        });

        const companyUidsByUser = new Map<number, string[]>();

        for (const assignment of assignments) {
          const list = companyUidsByUser.get(assignment.userId) || [];
          list.push(assignment.companyUid);
          companyUidsByUser.set(assignment.userId, list);
        }

        const allCompanyUids = [...new Set(assignments.map((a) => a.companyUid))];

        const companies = allCompanyUids.length
          ? await app.prisma.company.findMany({
              where: { uid: { in: allCompanyUids } },
              select: { uid: true, name: true }
            })
          : [];

        const companyNameByUid = new Map(companies.map((c) => [c.uid, c.name]));

        const queueAssignments = await app.prisma.userQueue.findMany({
          select: { userId: true, queueId: true }
        });

        const queueIdsByUser = new Map<number, number[]>();

        for (const assignment of queueAssignments) {
          const list = queueIdsByUser.get(assignment.userId) || [];
          list.push(assignment.queueId);
          queueIdsByUser.set(assignment.userId, list);
        }

        const allQueueIds = [...new Set(queueAssignments.map((a) => a.queueId))];

        const queues = allQueueIds.length
          ? await app.prisma.chatQueue.findMany({
              where: { id: { in: allQueueIds } },
              select: { id: true, name: true }
            })
          : [];

        const queueNameById = new Map(queues.map((q) => [q.id, q.name]));

        const data = users.map((user) => ({
          ...user,
          companies: (companyUidsByUser.get(user.id) || []).map((uid) => ({
            uid,
            name: companyNameByUid.get(uid) || uid
          })),
          queues: (queueIdsByUser.get(user.id) || []).map((id) => ({
            id,
            name: queueNameById.get(id) || String(id)
          }))
        }));

        return reply.send({ success: true, data });

      } catch (error) {

        app.log.error(error);

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error obteniendo usuarios"
        });
      }
    }
  );

  /**
   * POST /api/v1/admin/users
   */
  app.post<{ Body: CreateUserBody }>(
    "/users",
    {
      preHandler: async (request, reply) => {
        await request.jwtVerify();
        await requireRoot(request, reply);
      }
    },
    async (request, reply) => {

      const username = request.body?.username?.trim();
      const password = request.body?.password;
      const role = request.body?.role?.trim() || "user";
      const whatsapp = request.body?.whatsapp?.trim() || null;
      const companyUids = [...new Set(request.body?.companyUids || [])];
      const queueIds = [...new Set(request.body?.queueIds || [])];

      if (!username || !password) {
        return reply.status(400).send({
          success: false,
          error: "INVALID_BODY",
          message: "username y password son requeridos"
        });
      }

      if (!VALID_ROLES.includes(role)) {
        return reply.status(400).send({
          success: false,
          error: "INVALID_BODY",
          message: `role debe ser uno de: ${VALID_ROLES.join(", ")}`
        });
      }

      if (WHATSAPP_REQUIRED_ROLES.includes(role) && !whatsapp) {
        return reply.status(400).send({
          success: false,
          error: "INVALID_BODY",
          message: "whatsapp es requerido para el rol cliente"
        });
      }

      const actor = getActorFromRequest(request);

      try {

        const passwordHash = await bcrypt.hash(password, 12);

        const user = await app.prisma.user.create({
          data: { username, passwordHash, role, whatsapp, active: true }
        });

        if (companyUids.length) {
          await app.prisma.userCompany.createMany({
            data: companyUids.map((companyUid) => ({ userId: user.id, companyUid })),
            skipDuplicates: true
          });
        }

        if (queueIds.length) {
          await app.prisma.userQueue.createMany({
            data: queueIds.map((queueId) => ({ userId: user.id, queueId })),
            skipDuplicates: true
          });
        }

        await logAction(app.prisma, {
          ...actor,
          module: "users",
          action: "create",
          resource: username,
          success: true,
          requestBody: { username, role, companyUids, queueIds },
          afterState: { id: user.id, username, role, companyUids, queueIds }
        });

        return reply.status(201).send({
          success: true,
          data: { id: user.id, username: user.username, role: user.role, whatsapp: user.whatsapp, active: user.active, companyUids, queueIds }
        });

      } catch (error: any) {

        if (error?.code === "P2002") {

          // Prisma 7 + adaptador MariaDB: el detalle real queda en
          // meta.driverAdapterError.cause.constraint.index, no en
          // meta.target como en versiones anteriores de Prisma
          // (confirmado con el error real 2026-10-26).
          const constraintIndex = String(
            error?.meta?.driverAdapterError?.cause?.constraint?.index || ""
          );
          const isWhatsappDup = constraintIndex.includes("whatsapp");

          await logAction(app.prisma, {
            ...actor,
            module: "users",
            action: "create",
            resource: username,
            success: false,
            message: isWhatsappDup ? "whatsapp ya está vinculado a otra cuenta" : "Usuario ya existe",
            requestBody: { username, role, companyUids }
          });

          return reply.status(409).send({
            success: false,
            error: isWhatsappDup ? "WHATSAPP_ALREADY_LINKED" : "USER_ALREADY_EXISTS",
            message: isWhatsappDup
              ? "Ese número de WhatsApp ya está vinculado a otra cuenta"
              : "Ya existe un usuario con ese username"
          });
        }

        app.log.error(error);

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error creando el usuario"
        });
      }
    }
  );

  /**
   * PATCH /api/v1/admin/users/:id
   *
   * companyUids, si se envía, reemplaza el conjunto completo de
   * empresas asignadas (no hace un merge).
   */
  app.patch<{ Params: UserIdParams; Body: UpdateUserBody }>(
    "/users/:id",
    {
      preHandler: async (request, reply) => {
        await request.jwtVerify();
        await requireRoot(request, reply);
      }
    },
    async (request, reply) => {

      const id = parseInt(request.params.id, 10);

      if (isNaN(id)) {
        return reply.status(400).send({
          success: false,
          error: "INVALID_ID",
          message: "id inválido"
        });
      }

      if (request.body.role !== undefined && !VALID_ROLES.includes(request.body.role)) {
        return reply.status(400).send({
          success: false,
          error: "INVALID_BODY",
          message: `role debe ser uno de: ${VALID_ROLES.join(", ")}`
        });
      }

      const actor = getActorFromRequest(request);

      try {

        const existing = await app.prisma.user.findUnique({ where: { id } });

        if (!existing) {
          return reply.status(404).send({
            success: false,
            error: "USER_NOT_FOUND",
            message: "Usuario no encontrado"
          });
        }

        /**
         * whatsapp obligatorio para administrador/supervisor/agente —
         * se valida contra el rol EFECTIVO después del update (el que
         * viene en el body si se manda, si no el que ya tenía), y el
         * whatsapp EFECTIVO de la misma forma, para cubrir tanto
         * "le cambio el rol a uno que lo exige y no mandó whatsapp"
         * como "le borra el whatsapp a alguien que ya tenía un rol
         * que lo requiere".
         */
        const effectiveRole = request.body.role !== undefined ? request.body.role : existing.role;
        const effectiveWhatsapp =
          request.body.whatsapp !== undefined ? request.body.whatsapp?.trim() || null : existing.whatsapp;

        if (WHATSAPP_REQUIRED_ROLES.includes(effectiveRole) && !effectiveWhatsapp) {
          return reply.status(400).send({
            success: false,
            error: "INVALID_BODY",
            message: "whatsapp es requerido para el rol cliente"
          });
        }

        const data: { role?: string; whatsapp?: string | null; active?: boolean; passwordHash?: string } = {};

        if (request.body.role !== undefined) {
          data.role = request.body.role;
        }

        if (request.body.whatsapp !== undefined) {
          data.whatsapp = request.body.whatsapp?.trim() || null;
        }

        if (request.body.active !== undefined) {
          data.active = request.body.active;
        }

        if (request.body.password) {
          data.passwordHash = await bcrypt.hash(request.body.password, 12);
        }

        const updated = await app.prisma.user.update({ where: { id }, data });

        if (request.body.companyUids !== undefined) {

          const companyUids = [...new Set(request.body.companyUids)];

          await app.prisma.userCompany.deleteMany({ where: { userId: id } });

          if (companyUids.length) {
            await app.prisma.userCompany.createMany({
              data: companyUids.map((companyUid) => ({ userId: id, companyUid })),
              skipDuplicates: true
            });
          }
        }

        if (request.body.queueIds !== undefined) {

          const queueIds = [...new Set(request.body.queueIds)];

          await app.prisma.userQueue.deleteMany({ where: { userId: id } });

          if (queueIds.length) {
            await app.prisma.userQueue.createMany({
              data: queueIds.map((queueId) => ({ userId: id, queueId })),
              skipDuplicates: true
            });
          }
        }

        await logAction(app.prisma, {
          ...actor,
          module: "users",
          action: "update",
          resource: existing.username,
          success: true,
          beforeState: { role: existing.role, active: existing.active },
          afterState: {
            role: updated.role,
            active: updated.active,
            companyUids: request.body.companyUids,
            queueIds: request.body.queueIds
          }
        });

        return reply.send({
          success: true,
          data: { id: updated.id, username: updated.username, role: updated.role, whatsapp: updated.whatsapp, active: updated.active }
        });

      } catch (error: any) {

        const constraintIndex = String(
          error?.meta?.driverAdapterError?.cause?.constraint?.index || ""
        );

        if (error?.code === "P2002" && constraintIndex.includes("whatsapp")) {
          return reply.status(409).send({
            success: false,
            error: "WHATSAPP_ALREADY_LINKED",
            message: "Ese número de WhatsApp ya está vinculado a otra cuenta"
          });
        }

        app.log.error(error);

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error actualizando el usuario"
        });
      }
    }
  );

  /**
   * DELETE /api/v1/admin/users/:id
   */
  app.delete<{ Params: UserIdParams }>(
    "/users/:id",
    {
      preHandler: async (request, reply) => {
        await request.jwtVerify();
        await requireRoot(request, reply);
      }
    },
    async (request, reply) => {

      const id = parseInt(request.params.id, 10);

      if (isNaN(id)) {
        return reply.status(400).send({
          success: false,
          error: "INVALID_ID",
          message: "id inválido"
        });
      }

      if (id === request.user.sub) {
        return reply.status(400).send({
          success: false,
          error: "CANNOT_DELETE_SELF",
          message: "No puedes eliminar tu propio usuario"
        });
      }

      const actor = getActorFromRequest(request);

      try {

        const existing = await app.prisma.user.findUnique({ where: { id } });

        if (!existing) {
          return reply.status(404).send({
            success: false,
            error: "USER_NOT_FOUND",
            message: "Usuario no encontrado"
          });
        }

        await app.prisma.userCompany.deleteMany({ where: { userId: id } });
        /** Bug real (2026-10-27): sin esto quedaban asignaciones a
         * colas de usuarios borrados — la cola "Prueba" figuraba con 2
         * miembros que ya no existían. */
        await app.prisma.userQueue.deleteMany({ where: { userId: id } });
        await app.prisma.chatNotification.deleteMany({ where: { userId: id } });
        await app.prisma.user.delete({ where: { id } });

        await logAction(app.prisma, {
          ...actor,
          module: "users",
          action: "delete",
          resource: existing.username,
          success: true,
          beforeState: { username: existing.username, role: existing.role, active: existing.active }
        });

        return reply.send({ success: true });

      } catch (error) {

        app.log.error(error);

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error eliminando el usuario"
        });
      }
    }
  );
};

export default usersRoutes;
