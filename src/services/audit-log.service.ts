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
  /** Parámetros/body que envió quien ejecutó el endpoint. */
  requestBody?: unknown;
  /** Estado del registro antes del cambio (update) o antes de borrarlo
   * (delete, sirve como respaldo de cómo estaba configurado). */
  beforeState?: unknown;
  /** Estado del registro después del cambio (create/update). */
  afterState?: unknown;
}

const REDACTED = "***";
const SENSITIVE_KEYS = ["pin", "puk", "password", "passwordHash"];

/**
 * Copia superficial de un objeto (o array de objetos) enmascarando
 * campos sensibles (PIN/PUK de SIM, contraseñas) antes de guardarlos
 * en el log de auditoría — para dejar constancia de que el campo se
 * envió/cambió sin persistir el valor real en texto plano.
 */
function redact(value: unknown): unknown {

  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }

  if (value && typeof value === "object") {
    const clone: Record<string, unknown> = { ...(value as Record<string, unknown>) };

    for (const key of Object.keys(clone)) {
      if (SENSITIVE_KEYS.includes(key) && clone[key] != null) {
        clone[key] = REDACTED;
      }
    }

    return clone;
  }

  return value;
}

function toJson(value: unknown): string | null {

  if (value === undefined) {
    return null;
  }

  return JSON.stringify(redact(value));
}

/**
 * Registro de auditoría para cualquier endpoint que inserte, actualice
 * o elimine información en 3Dtracking: quién lo ejecutó (userId /
 * username, tomados del JWT), qué módulo/acción, sobre qué recurso, si
 * tuvo éxito, los parámetros enviados (requestBody) y, cuando aplica,
 * el estado antes/después del registro (beforeState/afterState — en
 * un delete, beforeState es el respaldo de cómo estaba configurado
 * antes de eliminarlo). Los campos sensibles (pin, puk, password) se
 * enmascaran antes de guardarse. Nunca lanza: un fallo guardando el
 * log no debe tumbar la operación real que se está auditando.
 *
 * Patrón a seguir en endpoints nuevos que escriban en 3Dtracking:
 * llamar logAction() justo después de intentar la operación (éxito o
 * error), usando getActorFromRequest() para obtener el actor, y
 * pasando requestBody siempre, más beforeState/afterState según
 * aplique (create: afterState; update: beforeState + afterState;
 * delete: beforeState).
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
        message: entry.message ?? null,
        requestBody: toJson(entry.requestBody),
        beforeState: toJson(entry.beforeState),
        afterState: toJson(entry.afterState)
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
