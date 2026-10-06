import { PrismaClient } from "@prisma/client";

import { DmsMessagingClient } from "../integrations/dms-messaging/messaging.client";

const BATCH_LIMIT = 20;
/**
 * Notificaciones por WhatsApp restringidas a esta unidad únicamente
 * (instrucción explícita del usuario, 2026-09-21) — mientras se
 * investiga por qué los mensajes no están llegando, se acota el
 * despacho a "Telefono Mauricio" (22A847) para no seguir enviando
 * mensajes reales por otras unidades. No afecta la detección/
 * almacenamiento (sigue igual para las demás unidades habilitadas,
 * ej. 5D23E9 para combustible) — solo el envío queda pausado para
 * ellas, sus eventos quedan pendientes (whatsappStatus NULL) por si
 * se levanta la restricción después.
 */
const WHATSAPP_DISPATCH_ENABLED_UNIT_UIDS = new Set(["22A847"]);

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
 * Company.contactPhone (y por lo tanto CriticalAlertEvent.contactPhone,
 * copiado de ahí al momento de guardar la alarma) puede traer varios
 * números separados por coma — se envía un mensaje independiente a
 * cada uno.
 */
export function parsePhones(contactPhone: string): string[] {
  return contactPhone
    .split(",")
    .map((p) => p.trim())
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
  dmsMessaging: DmsMessagingClient
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
      unitUid: { in: [...WHATSAPP_DISPATCH_ENABLED_UNIT_UIDS] }
    },
    orderBy: { occurredAt: "asc" },
    take: BATCH_LIMIT
  });

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

    const phones = parsePhones(event.contactPhone as string);

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
 * Arma (sin enviar) el texto exacto y los números a los que se
 * mandaría el WhatsApp de un evento puntual. Usado por dos
 * consumidores que DEBEN ver el mismo texto: la vista previa que pide
 * el frontend antes de que el usuario confirme el reenvío (evitar
 * sorpresas tipo "no sabía que iba a mandar esto" — ver incidente
 * 2026-10-06 donde se reenvió un WhatsApp real sin preview) y
 * resendWhatsappForEvent, que reutiliza este mismo resultado para
 * enviar en vez de recalcularlo aparte.
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

  if (!event.contactPhone) {
    return {
      configured: false,
      phones: [],
      message: null,
      unitName: event.unitName,
      unitUid: event.unitUid,
      reason: "El evento no tiene un número de contacto asociado"
    };
  }

  const phones = parsePhones(event.contactPhone);

  if (phones.length === 0) {
    return {
      configured: false,
      phones: [],
      message: null,
      unitName: event.unitName,
      unitUid: event.unitUid,
      reason: "contactPhone vacío tras separar por coma"
    };
  }

  const locationLink = buildLocationLink(event.latitude, event.longitude);

  const message =
    `${event.alertTypeName} — ${event.unitName || event.unitUid} — ` +
    formatOccurredAt(event.occurredAt) +
    (locationLink ? ` — Ubicación: ${locationLink}` : "");

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
 * WHATSAPP_DISPATCH_ENABLED_UNIT_UIDS ni exige whatsappStatus null —
 * es una acción explícita de un usuario root/admin sobre un evento
 * específico que ya confirmó reenviar (el frontend muestra
 * buildWhatsappPreview antes de llegar acá), no el despacho
 * automático/masivo que todavía está acotado mientras se investiga la
 * entrega.
 */
export async function resendWhatsappForEvent(
  prisma: PrismaClient,
  dmsMessaging: DmsMessagingClient,
  eventId: number
): Promise<ResendResult> {

  const preview = await buildWhatsappPreview(prisma, eventId);

  if (!preview.configured || !preview.message) {
    return { success: false, message: preview.reason || "No se pudo preparar el mensaje", phones: [] };
  }

  const config = await prisma.whatsappAlertConfig.findFirst({
    where: { active: true }
  });

  if (!config?.templateId || !config.accountId) {
    return { success: false, message: "No hay una plantilla de WhatsApp activa configurada", phones: [] };
  }

  const failedPhones: string[] = [];

  for (const phone of preview.phones) {

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

    return { success: false, message: failedPhones.join(" | "), phones: preview.phones };
  }

  await prisma.criticalAlertEvent.update({
    where: { id: eventId },
    data: { whatsappStatus: "sent", whatsappSentAt: new Date(), whatsappError: null }
  });

  return { success: true, phones: preview.phones };
}
