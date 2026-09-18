import { PrismaClient } from "@prisma/client";

import { DmsMessagingClient } from "../integrations/dms-messaging/messaging.client";

const ALERT_CONFIG_ID = 1;
const BATCH_LIMIT = 20;

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

function formatOccurredAt(date: Date): string {
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

  const config = await prisma.whatsappAlertConfig.findUnique({
    where: { id: ALERT_CONFIG_ID }
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
      alertTypeCode: { in: allowedCodes }
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

    result.attempted++;

    const phone = event.contactPhone as string;

    const messageLine =
      `${event.alertTypeName} — ${event.unitName || event.unitUid} — ` +
      formatOccurredAt(event.occurredAt);

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

        await prisma.criticalAlertEvent.update({
          where: { id: event.id },
          data: { whatsappStatus: "sent", whatsappSentAt: new Date(), whatsappError: null }
        });

        result.sent++;

      } else {

        await prisma.criticalAlertEvent.update({
          where: { id: event.id },
          data: {
            whatsappStatus: "error",
            whatsappError: sendResult.message || sendResult.error || `HTTP ${sendResult.httpStatus}`
          }
        });

        result.failed++;
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

      await prisma.criticalAlertEvent.update({
        where: { id: event.id },
        data: { whatsappStatus: "error", whatsappError: message }
      });

      result.failed++;

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

  return result;
}
