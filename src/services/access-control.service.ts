import { PrismaClient } from "@prisma/client";
import { FastifyRequest, FastifyReply } from "fastify";

export type UserRole = "root" | "admin" | "user";

/**
 * Devuelve las empresas asignadas a un usuario, o null si no aplica
 * restricción (root ve todo). admin/user con cero empresas asignadas
 * reciben un array vacío — ven cero registros en los módulos con
 * filtro por empresa, no todos por defecto (fail-closed).
 */
export async function getAllowedCompanyUids(
  prisma: PrismaClient,
  userId: number,
  role: string
): Promise<string[] | null> {

  if (role === "root") {
    return null;
  }

  const rows = await prisma.userCompany.findMany({
    where: { userId },
    select: { companyUid: true }
  });

  return rows.map((row) => row.companyUid);
}

/**
 * root y admin pueden crear/editar/eliminar; user es de solo lectura.
 */
export function canWrite(role: string): boolean {
  return role === "root" || role === "admin";
}

/**
 * Preheader reusable: bloquea cualquier endpoint de escritura para
 * rol "user" (solo lectura). Usar junto con la autenticación, ej.
 * preHandler: [fastify.authenticate, requireWrite] o, en las rutas
 * que verifican con request.jwtVerify() inline:
 * preHandler: async (request, reply) => { await request.jwtVerify(); await requireWrite(request, reply); }
 */
export async function requireWrite(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {

  if (!canWrite(request.user.role)) {

    reply.status(403).send({
      success: false,
      error: "FORBIDDEN",
      message: "Tu rol no permite crear, editar ni eliminar registros"
    });
  }
}

/**
 * Igual que requireWrite pero exige rol root específicamente — para
 * acciones administrativas globales (gestión de usuarios/empresas,
 * sync completo de compañías, catálogo completo de 3Dtracking).
 */
export async function requireRoot(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {

  if (!isRoot(request.user.role)) {

    reply.status(403).send({
      success: false,
      error: "FORBIDDEN",
      message: "Esta acción requiere rol root"
    });
  }
}

export function isRoot(role: string): boolean {
  return role === "root";
}

/**
 * Resuelve los uid de Tracker asignados a unidades dentro de las
 * empresas permitidas — usado para filtrar SIMs/Trackers por empresa.
 *
 * Usa Unit.trackerUid (no Tracker.unitUid): Tracker.unitUid solo se
 * llena cuando la asignación se hizo a través del flujo explícito de
 * asignar/quitar tracker de esta API — la gran mayoría de unidades
 * tiene su tracker resuelto por otra vía (coincidencia de IMEI en el
 * sync de catálogo, ver units-sync.service.ts) que solo actualiza
 * Unit.trackerUid. Confirmado con datos reales: usar Tracker.unitUid
 * acá dejaba fuera casi todos los trackers de una empresa con
 * unidades reales asignadas.
 */
export async function getAllowedTrackerUids(
  prisma: PrismaClient,
  allowedCompanyUids: string[]
): Promise<string[]> {

  if (allowedCompanyUids.length === 0) {
    return [];
  }

  const units = await prisma.unit.findMany({
    where: {
      companyUid: { in: allowedCompanyUids },
      trackerUid: { not: null }
    },
    select: { trackerUid: true }
  });

  return units
    .map((unit) => unit.trackerUid)
    .filter((uid): uid is string => Boolean(uid));
}
