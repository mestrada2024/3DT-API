import { PrismaClient } from "@prisma/client";

import { DmsMessagingClient } from "../integrations/dms-messaging/messaging.client";
import { Tracking3DService } from "../integrations/3dtracking/tracking.service";

const BATCH_LIMIT = 20;
/**
 * Despacho automático de WhatsApp habilitado por empresa — pedido
 * explícito del usuario 2026-10-08: se saca la restricción anterior
 * a una sola unidad (22A847, que era temporal mientras se investigaba
 * por qué no llegaban los mensajes — ya resuelto, ver el fix de
 * matching de nombre en webhooks-3dt.ts) y en su lugar se acota a la
 * flota de DADA-DADA (2C809B) — mismo alcance que ya usa el resto del
 * sistema para esta empresa (ver ENABLED_CLIENT_COMPANY_UIDS en
 * webhooks-3dt.ts y critical-alert.service.ts). Qué tipos de alerta
 * notifican por WhatsApp ya lo decide AllowedAlertType (configurable
 * desde el módulo Alertas) — esto solo acota por empresa, no por tipo
 * de alerta ni por unidad individual.
 */
const WHATSAPP_DISPATCH_ENABLED_COMPANY_UIDS = new Set(["2C809B"]);

export interface DispatchResult {
  reason: "not_configured" | "ok";
  attempted: number;
  sent: number;
  failed: number;
  results: Array<{
    eventId: number;
    unitName: string | null;
    alertTypeName: string;
    phone: string;
    success: boolean;
    message?: string;
  }>;
}

/**
 * DMS SMART/WhatsApp no entrega al número salvadoreño de 8 dígitos
 * con el código de país (503) por delante, aunque la API conteste
 * success:true igual — confirmado con una prueba A/B real 2026-10-08
 * (mismo destinatario: "50377373997" no llegó, "77373997" sí). La
 * mayoría de empresas ya guardan el número en formato local de 8
 * dígitos (a veces con espacio, ej. "6304 4451") — DADA-DADA es la
 * única que lo tiene con 503 adelante. Se recorta acá, al momento de
 * enviar, en vez de tocar los datos guardados en Company.contactPhone
 * (no se sabe si DMS SMART trata igual a todos los números
 * salvadoreños con 503, o si es específico de estos 3 — recortar en
 * el envío es reversible y no afecta cómo se ve el dato en el admin).
 */
function normalizePhone(raw: string): string {
  const digits = raw.trim().replace(/[^0-9]/g, "");
  return digits.length === 11 && digits.startsWith("503") ? digits.slice(3) : digits;
}

/**
 * Company.contactPhone (y por lo tanto CriticalAlertEvent.contactPhone,
 * copiado de ahí al momento de guardar la alarma) puede traer varios
 * números separados por coma — se envía un mensaje independiente a
 * cada uno.
 */
export function parsePhones(contactPhone: string): string[] {
  return contactPhone
    .split(",")
    .map((p) => normalizePhone(p))
    .filter((p) => p.length > 0);
}

export function formatOccurredAt(date: Date): string {
  return date.toLocaleString("es-SV", {
    timeZone: "America/El_Salvador",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/**
 * Link de Google Maps con la ubicación desde donde transmitió el
 * equipo — pedido explícito del usuario para poder ver de dónde vino
 * la alerta directo desde el mensaje de WhatsApp, sin entrar a la
 * plataforma. Formato "https://www.google.com/maps?q=lat,lng" abre
 * directo en un pin, funciona igual en la app de Maps (móvil) y en
 * el navegador.
 */
export function buildLocationLink(latitude: unknown, longitude: unknown): string | null {
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
    return null;
  }

  return `https://www.google.com/maps?q=${Number(latitude)},${Number(longitude)}`;
}

/**
 * Lee CriticalAlertEvent en busca de alertas pendientes de notificar
 * por WhatsApp y las envía vía DMS SMART, siguiendo el diseño
 * documentado en docs/dms-messaging.md (evaluado y confirmado con el
 * usuario 2026-09-18): estado en la misma fila
 * (whatsappStatus null → "sending" → "sent"/"error"), reclamado con
 * un único UPDATE atómico antes de llamar a DMS SMART, para que dos
 * corridas concurrentes nunca envíen el mismo evento dos veces.
 *
 * Elegibles: whatsappStatus IS NULL (los eventos ya existentes al
 * 2026-09-18 quedaron marcados "skipped_backfill" a propósito — solo
 * alarmas nuevas entran acá) + contactPhone ya resuelto (hoy, solo
 * DADA-DADA — ver ENABLED_CLIENT_COMPANY_UIDS en
 * critical-alert.service.ts) + alertTypeCode presente en
 * AllowedAlertType (hoy, solo PANIC_BUTTON).
 */
export async function dispatchPendingWhatsappAlerts(
  prisma: PrismaClient,
  dmsMessaging: DmsMessagingClient,
  tracking3d: Tracking3DService
): Promise<DispatchResult> {

  const config = await prisma.whatsappAlertConfig.findFirst({
    where: { active: true }
  });

  if (!config?.templateId || !config.accountId) {
    return { reason: "not_configured", attempted: 0, sent: 0, failed: 0, results: [] };
  }

  const allowed = await prisma.allowedAlertType.findMany({
    select: { alertTypeCode: true }
  });

  const allowedCodes = allowed.map((a) => a.alertTypeCode);

  if (allowedCodes.length === 0) {
    return { reason: "ok", attempted: 0, sent: 0, failed: 0, results: [] };
  }

  const pending = await prisma.criticalAlertEvent.findMany({
    where: {
      whatsappStatus: null,
      contactPhone: { not: null },
      alertTypeCode: { in: allowedCodes },
      companyUid: { in: [...WHATSAPP_DISPATCH_ENABLED_COMPANY_UIDS] }
    },
    orderBy: { occurredAt: "asc" },
    take: BATCH_LIMIT
  });

  /**
   * El despacho AUTOMÁTICO consulta el teléfono de contacto en vivo
   * contra 3Dtracking (campo "Teléfono de la persona de contacto" del
   * panel, ContactPhone en su API) en vez de usar
   * CriticalAlertEvent.contactPhone (una copia tomada al momento de
   * guardar la alarma, que puede quedar desactualizada si cambian el
   * contacto en 3DT después) — pedido explícito del usuario
   * 2026-10-08. Una sola llamada por corrida (no por evento) y con
   * fallback al valor guardado si 3DT no responde, para no bloquear
   * el despacho por un problema de 3Dtracking.
   */
  let liveContactPhoneByCompany = new Map<string, string | null>();

  if (pending.length > 0) {

    try {

      const session = await tracking3d.authenticate();
      const companies = await tracking3d.getCompanyList(session);

      liveContactPhoneByCompany = new Map(
        companies.map((c) => [c.Uid, c.ContactPhone || null])
      );

    } catch {
      // Sin esto, cada evento cae al contactPhone guardado (ver abajo).
    }
  }

  const result: DispatchResult = {
    reason: "ok",
    attempted: 0,
    sent: 0,
    failed: 0,
    results: []
  };

  for (const event of pending) {

    const claimed = await prisma.criticalAlertEvent.updateMany({
      where: { id: event.id, whatsappStatus: null },
      data: { whatsappStatus: "sending" }
    });

    if (claimed.count === 0) {
      continue;
    }

    const liveContactPhone = event.companyUid
      ? liveContactPhoneByCompany.get(event.companyUid)
      : undefined;

    const contactPhone = liveContactPhone || event.contactPhone;

    const phones = parsePhones(contactPhone as string);

    if (phones.length === 0) {

      await prisma.criticalAlertEvent.update({
        where: { id: event.id },
        data: { whatsappStatus: "error", whatsappError: "contactPhone vacío tras separar por coma" }
      });

      continue;
    }

    const locationLink = buildLocationLink(event.latitude, event.longitude);

    const messageLine =
      `${event.alertTypeName} — ${event.unitName || event.unitUid} — ` +
      formatOccurredAt(event.occurredAt) +
      (locationLink ? ` — Ubicación: ${locationLink}` : "");

    const failedPhones: string[] = [];

    for (const phone of phones) {

      result.attempted++;

      try {

        const sendResult = await dmsMessaging.sendMessage({
          first_name: event.unitName || event.unitUid,
          phone,
          accountId: config.accountId,
          channelId: config.channelId || undefined,
          templateId: config.templateId,
          templateBody: { "1": messageLine },
          type: "notification"
        });

        if (sendResult.success) {
          result.sent++;
        } else {
          result.failed++;
          failedPhones.push(`${phone}: ${sendResult.message || sendResult.error || `HTTP ${sendResult.httpStatus}`}`);
        }

        result.results.push({
          eventId: event.id,
          unitName: event.unitName,
          alertTypeName: event.alertTypeName,
          phone,
          success: sendResult.success,
          message: sendResult.message || sendResult.error
        });

      } catch (error) {

        const message = (error as Error).message;

        result.failed++;
        failedPhones.push(`${phone}: ${message}`);

        result.results.push({
          eventId: event.id,
          unitName: event.unitName,
          alertTypeName: event.alertTypeName,
          phone,
          success: false,
          message
        });
      }
    }

    /**
     * Estado a nivel de evento: "sent" solo si TODOS los números
     * recibieron el mensaje. Si alguno falló, queda "error" con el
     * detalle de cuáles — no se reintenta automáticamente (evita
     * volver a mandarle el mensaje a los números que sí funcionaron).
     */
    if (failedPhones.length === 0) {

      await prisma.criticalAlertEvent.update({
        where: { id: event.id },
        data: { whatsappStatus: "sent", whatsappSentAt: new Date(), whatsappError: null }
      });

    } else {

      await prisma.criticalAlertEvent.update({
        where: { id: event.id },
        data: { whatsappStatus: "error", whatsappError: failedPhones.join(" | ") }
      });
    }
  }

  return result;
}

export interface WhatsappPreview {
  configured: boolean;
  phones: string[];
  message: string | null;
  unitName: string | null;
  unitUid: string | null;
  reason?: string;
}

/**
 * Arma (sin enviar) el texto exacto y los números configurados en la
 * empresa del evento. Usado por dos consumidores que DEBEN ver el
 * mismo texto: la vista previa que pide el frontend antes de que el
 * usuario confirme el reenvío (evitar sorpresas tipo "no sabía que
 * iba a mandar esto" — ver incidente 2026-10-06 donde se reenvió un
 * WhatsApp real sin preview) y resendWhatsappForEvent, que reutiliza
 * este mismo resultado en vez de recalcularlo aparte.
 *
 * `message` se arma siempre que haya plantilla activa y el evento
 * exista, aunque `phones` quede vacío (empresa sin número
 * configurado) — el frontend permite reenviar a un número escrito a
 * mano en ese caso (ver resendWhatsappForEvent), y para eso necesita
 * el texto igual. `configured:false` únicamente cuando no hay
 * plantilla activa o el evento no existe, no cuando faltan números.
 */
export async function buildWhatsappPreview(
  prisma: PrismaClient,
  eventId: number
): Promise<WhatsappPreview> {

  const config = await prisma.whatsappAlertConfig.findFirst({
    where: { active: true }
  });

  if (!config?.templateId || !config.accountId) {
    return {
      configured: false,
      phones: [],
      message: null,
      unitName: null,
      unitUid: null,
      reason: "No hay una plantilla de WhatsApp activa configurada"
    };
  }

  const event = await prisma.criticalAlertEvent.findUnique({
    where: { id: eventId }
  });

  if (!event) {
    return { configured: false, phones: [], message: null, unitName: null, unitUid: null, reason: "Evento no encontrado" };
  }

  const locationLink = buildLocationLink(event.latitude, event.longitude);

  const message =
    `${event.alertTypeName} — ${event.unitName || event.unitUid} — ` +
    formatOccurredAt(event.occurredAt) +
    (locationLink ? ` — Ubicación: ${locationLink}` : "");

  const phones = event.contactPhone ? parsePhones(event.contactPhone) : [];

  if (phones.length === 0) {
    return {
      configured: true,
      phones: [],
      message,
      unitName: event.unitName,
      unitUid: event.unitUid,
      reason: "La empresa no tiene números de contacto configurados para este evento"
    };
  }

  return { configured: true, phones, message, unitName: event.unitName, unitUid: event.unitUid };
}

export interface ResendResult {
  success: boolean;
  message?: string;
  phones: string[];
}

/**
 * Reenvía el WhatsApp de UN evento puntual, disparado a mano desde el
 * módulo de Alertas del frontend (botón "Reenviar WhatsApp"). A
 * diferencia de dispatchPendingWhatsappAlerts no aplica
 * WHATSAPP_DISPATCH_ENABLED_COMPANY_UIDS ni exige whatsappStatus null —
 * es una acción explícita de un usuario root/admin sobre un evento
 * específico que ya confirmó reenviar (el frontend muestra
 * buildWhatsappPreview antes de llegar acá), no el despacho
 * automático/masivo que todavía está acotado mientras se investiga la
 * entrega.
 *
 * `overridePhone` (pedido explícito del usuario, 2026-10-06): si se
 * manda, reemplaza por completo a los números configurados en la
 * empresa — se envía solo a ese destino. Útil para una prueba puntual
 * o cuando el evento no tiene contactPhone. No modifica
 * CriticalAlertEvent.contactPhone ni afecta el despacho automático.
 */
export async function resendWhatsappForEvent(
  prisma: PrismaClient,
  dmsMessaging: DmsMessagingClient,
  eventId: number,
  overridePhone?: string
): Promise<ResendResult> {

  const preview = await buildWhatsappPreview(prisma, eventId);

  if (!preview.configured || !preview.message) {
    return { success: false, message: preview.reason || "No se pudo preparar el mensaje", phones: [] };
  }

  const targetPhones = overridePhone?.trim() ? [overridePhone.trim()] : preview.phones;

  if (targetPhones.length === 0) {
    return { success: false, message: preview.reason || "No hay un número destino", phones: [] };
  }

  const config = await prisma.whatsappAlertConfig.findFirst({
    where: { active: true }
  });

  if (!config?.templateId || !config.accountId) {
    return { success: false, message: "No hay una plantilla de WhatsApp activa configurada", phones: [] };
  }

  const failedPhones: string[] = [];

  for (const phone of targetPhones) {

    try {

      const sendResult = await dmsMessaging.sendMessage({
        first_name: preview.unitName || preview.unitUid || phone,
        phone,
        accountId: config.accountId,
        channelId: config.channelId || undefined,
        templateId: config.templateId,
        templateBody: { "1": preview.message },
        type: "notification"
      });

      if (!sendResult.success) {
        failedPhones.push(`${phone}: ${sendResult.message || sendResult.error || `HTTP ${sendResult.httpStatus}`}`);
      }

    } catch (error) {

      failedPhones.push(`${phone}: ${(error as Error).message}`);
    }
  }

  if (failedPhones.length > 0) {

    await prisma.criticalAlertEvent.update({
      where: { id: eventId },
      data: { whatsappStatus: "error", whatsappError: failedPhones.join(" | ") }
    });

    return { success: false, message: failedPhones.join(" | "), phones: targetPhones };
  }

  await prisma.criticalAlertEvent.update({
    where: { id: eventId },
    data: { whatsappStatus: "sent", whatsappSentAt: new Date(), whatsappError: null }
  });

  return { success: true, phones: targetPhones };
}
