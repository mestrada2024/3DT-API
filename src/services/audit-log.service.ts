import { PrismaClient } from "@prisma/client";

export interface AuditActor {
  userId?: number | null;
  username?: string | null;
}

export interface AuditLogInput extends AuditActor {
  module: string;
  action: string;
  resource?: string | null;
  success: boolean;
  message?: string | null;
}

/**
 * Registro de auditoría para cualquier endpoint que inserte, actualice
 * o elimine información en 3Dtracking: quién lo ejecutó (userId /
 * username, tomados del JWT), qué módulo/acción, sobre qué recurso, y
 * si tuvo éxito. Nunca lanza: un fallo guardando el log no debe tumbar
 * la operación real que se está auditando.
 *
 * Patrón a seguir en endpoints nuevos que escriban en 3Dtracking:
 * llamar logAction() justo después de intentar la operación (éxito o
 * error), usando getActorFromRequest() para obtener el actor.
 */
export async function logAction(
  prisma: PrismaClient,
  entry: AuditLogInput
): Promise<void> {

  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        username: entry.username ?? null,
        module: entry.module,
        action: entry.action,
        resource: entry.resource ?? null,
        success: entry.success,
        message: entry.message ?? null
      }
    });
  } catch (error) {
    console.error("Error guardando audit log:", error);
  }
}

interface JwtUserPayload {
  sub?: number;
  username?: string;
}

/**
 * Extrae el actor (userId/username) del JWT ya verificado
 * (request.jwtVerify() debe haberse llamado antes en un preHandler).
 */
export function getActorFromRequest(request: { user?: unknown }): AuditActor {

  const payload = request.user as JwtUserPayload | undefined;

  return {
    userId: payload?.sub ?? null,
    username: payload?.username ?? null
  };
}
