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
  companyUids?: string[];
}

interface UpdateUserBody {
  password?: string;
  role?: string;
  active?: boolean;
  companyUids?: string[];
}

const VALID_ROLES = ["root", "admin", "user"];

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

        const data = users.map((user) => ({
          ...user,
          companies: (companyUidsByUser.get(user.id) || []).map((uid) => ({
            uid,
            name: companyNameByUid.get(uid) || uid
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
      const companyUids = [...new Set(request.body?.companyUids || [])];

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

      const actor = getActorFromRequest(request);

      try {

        const passwordHash = await bcrypt.hash(password, 12);

        const user = await app.prisma.user.create({
          data: { username, passwordHash, role, active: true }
        });

        if (companyUids.length) {
          await app.prisma.userCompany.createMany({
            data: companyUids.map((companyUid) => ({ userId: user.id, companyUid })),
            skipDuplicates: true
          });
        }

        await logAction(app.prisma, {
          ...actor,
          module: "users",
          action: "create",
          resource: username,
          success: true,
          requestBody: { username, role, companyUids },
          afterState: { id: user.id, username, role, companyUids }
        });

        return reply.status(201).send({
          success: true,
          data: { id: user.id, username: user.username, role: user.role, active: user.active, companyUids }
        });

      } catch (error: any) {

        if (error?.code === "P2002") {

          await logAction(app.prisma, {
            ...actor,
            module: "users",
            action: "create",
            resource: username,
            success: false,
            message: "Usuario ya existe",
            requestBody: { username, role, companyUids }
          });

          return reply.status(409).send({
            success: false,
            error: "USER_ALREADY_EXISTS",
            message: "Ya existe un usuario con ese username"
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

        const data: { role?: string; active?: boolean; passwordHash?: string } = {};

        if (request.body.role !== undefined) {
          data.role = request.body.role;
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
            companyUids: request.body.companyUids
          }
        });

        return reply.send({
          success: true,
          data: { id: updated.id, username: updated.username, role: updated.role, active: updated.active }
        });

      } catch (error) {

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
