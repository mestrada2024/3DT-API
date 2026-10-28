import { ChatQueue, ChatTicket, PrismaClient } from "@prisma/client";

import { Tracking3DService } from "../integrations/3dtracking/tracking.service";
import { QueryEngineResult, routeQuery } from "./query-engine.service";
import { buildUnitReportPdf } from "./report-pdf.service";
import { createLiveShareLink } from "./live-share.service";
import { getUnitTripsForRange } from "./unit-trips.service";
import { notifyAgentRequest } from "./chat-notification.service";

/**
 * Motor de menú del chatbot por colas — pedido del usuario
 * 2026-10-26:
 *
 * - Al primer mensaje de un ticket (la descripción con la que se
 *   crea, sin cola elegida), el bot responde con el saludo y el menú
 *   de colas principales.
 * - Cada opción del menú es una cola; el texto que se muestra es su
 *   description (o name si está vacía).
 * - Al elegir una cola con destination="cola", el bot muestra sus
 *   colas hijas (secundarias con parentId = esa cola).
 * - Al elegir una cola con destination="agentes", el ticket queda en
 *   ESA cola (la del último mensaje), sin reclamar, para sus agentes,
 *   y el bot deja de intervenir.
 *
 * Estado en ChatTicket: botStatus="menu" mientras el cliente navega
 * (botMenuQueueId = cola cuyas hijas se están mostrando, null = menú
 * principal); "consulta" cuando ya eligió una cola de agentes pero el
 * bot sigue atendiendo (botMenuQueueId = esa cola, queueId todavía
 * null — los agentes no lo ven); "transferido" cuando ya quedó en la
 * cola de agentes. null = el bot nunca intervino (ticket creado ya con
 * cola).
 *
 * Paso a agente a pedido (2026-10-27, pedido del usuario: "escriba su
 * consulta, si quiere ser atendido por un agente, escribe agente"):
 * elegir una opción con destino agentes ya NO manda el ticket a la
 * cola; el bot invita a escribir la consulta y recién cuando el
 * cliente escribe "agente" (o similar) el ticket entra a la cola.
 *
 * Consultas de flota (2026-10-26, ejemplo real ticket #7: "quiero
 * saber el estado del vehículo Telefono Mauricio"): cada mensaje del
 * cliente pasa además por el motor de consultas (query-engine) — si
 * reconoce estado/ubicación/alertas, el bot responde con el
 * resultado, sin importar si el ticket está en el menú o ya con un
 * agente. La consulta corre con los permisos de QUIEN CREÓ EL TICKET
 * (sus empresas), nunca con los de otro usuario.
 */

export const BOT_STATUS_MENU = "menu";
export const BOT_STATUS_SELF_SERVICE = "consulta";
export const BOT_STATUS_TRANSFERRED = "transferido";

/** Palabras con las que el cliente pide un agente humano. */
const AGENT_REQUEST_PATTERN = /\b(agente|agentes|asesor|asesora|humano|operador|operadora|persona)\b/;

/** Volver al menú desde el modo consulta. */
const MENU_REQUEST_PATTERN = /^(menu|0|volver|opciones|inicio)$/;

const SELF_SERVICE_HINT =
  "No entendí la consulta. Podés preguntar por ejemplo: \"estado de cv200\", \"últimas 5 alertas\", " +
  "\"combustible de cv200\", \"recorrido de cv200 del 26/10\", \"reporte de cv200 del 01/10 al 15/10\" o \"link en vivo de cv200\". " +
  "Si querés que te atienda un agente, escribí \"agente\"; para volver a las opciones, \"menú\".";

const HANDOFF_MESSAGE = "Listo, te comunicamos con un agente de {cola}; te va a responder en breve.";

/**
 * Mensajes sin consulta reconocida (pedido 2026-10-27: "para cuando
 * el chatbot reciba preguntas incoherentes, brindar un mensaje").
 */
const QUERY_EXAMPLES =
  "\"estado de cv200\", \"últimas 5 alertas\", \"combustible de cv200\", \"recorrido de cv200 del 26/10\", " +
  "\"reporte de cv200 del 01/10 al 15/10\" o \"link en vivo de cv200\"";

const GIBBERISH_MESSAGE =
  `No pude entender tu mensaje. ¿Podrías escribirlo de otra forma? Por ejemplo: ${QUERY_EXAMPLES}.`;

const UNRECOGNIZED_WAITING_MESSAGE =
  "No entendí la consulta, pero tu mensaje quedó registrado y un agente lo va a revisar. " +
  `Si es sobre tus vehículos, podés preguntar por ejemplo: ${QUERY_EXAMPLES}.`;

const GREETING_PATTERN = /^(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|que tal)\b/;
const THANKS_PATTERN = /^(gracias|muchas gracias|ok|okay|vale|perfecto|listo|entendido|excelente|genial)\b/;

/**
 * Texto sin palabras reconocibles: solo símbolos/números, o palabras
 * sin vocales ("asdfg", "jjjjj", "????"). No intenta ser un detector
 * de idioma — alcanza para no contestar "no entendí la consulta" a
 * algo que ni siquiera es una pregunta.
 */
function looksLikeGibberish(normalized: string): boolean {

  const words = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  const alphaWords = words.filter((w) => /[a-z]/.test(w));

  if (alphaWords.length === 0) return true;

  /** Palabra "real": tiene vocal, no repite 4+ veces la misma letra y
   * no tiene 5+ consonantes seguidas ("asdfgh" sí las tiene). */
  const plausible = alphaWords.filter(
    (w) => /[aeiou]/.test(w) && !/(.)\1{3,}/.test(w) && !/[bcdfghjklmnñpqrstvwxyz]{5,}/.test(w)
  );

  return plausible.length === 0;
}

/** Saludo o agradecimiento: respuesta de cortesía en vez de "no entendí". */
function courtesyReply(normalized: string): string | null {

  if (THANKS_PATTERN.test(normalized)) {
    return "¡Con gusto! Si necesitás algo más, escribí tu consulta.";
  }

  if (GREETING_PATTERN.test(normalized)) {
    return `¡Hola! Escribí tu consulta, por ejemplo: ${QUERY_EXAMPLES}.`;
  }

  return null;
}

/**
 * Respuesta para un mensaje que no es una consulta reconocida. Con un
 * agente ya asignado el bot no contesta: es conversación entre
 * personas y un "no entendí" a cada "ok" estorba.
 */
async function replyToUnrecognized(
  prisma: PrismaClient,
  ticket: ChatTicket,
  normalized: string,
  fallback: string
): Promise<void> {

  if (ticket.assignedToUserId !== null) {
    return;
  }

  const courtesy = courtesyReply(normalized);

  if (courtesy) {
    await addBotMessage(prisma, ticket.id, courtesy);
    return;
  }

  await addBotMessage(prisma, ticket.id, looksLikeGibberish(normalized) ? GIBBERISH_MESSAGE : fallback);
}

const BACK_TO_MAIN_OPTION = "0";

const CHAT_TIMEZONE = "America/El_Salvador";

const DEFAULT_CONFIG = {
  greeting: "¡Hola! ¿En qué podemos ayudarte? Respondé con el número de una opción:",
  invalidOption: "No reconocí esa opción. Respondé con el número de una de las opciones:",
  transferMessage:
    "Escribí tu consulta (por ejemplo: \"estado de cv200\", \"últimas 5 alertas\" o \"reporte de cv200 del 01/10 al 15/10\"). " +
    "Si querés que te atienda un agente de {cola}, escribí \"agente\"."
};

async function getConfig(prisma: PrismaClient) {

  const config = await prisma.chatBotConfig.findUnique({ where: { id: 1 } });

  return config ?? DEFAULT_CONFIG;
}

/**
 * Opciones visibles para un nivel del menú: las principales si
 * parentId es null, o las hijas activas de esa cola.
 */
export async function getMenuOptions(
  prisma: PrismaClient,
  parentId: number | null
): Promise<ChatQueue[]> {

  return prisma.chatQueue.findMany({
    where: parentId === null
      ? { active: true, kind: "principal", parentId: null }
      : { active: true, parentId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
  });
}

export function optionLabel(queue: ChatQueue): string {
  return queue.description?.trim() || queue.name;
}

export function formatMenu(header: string, options: ChatQueue[], showBack: boolean): string {

  const lines = options.map((q, index) => `${index + 1}. ${optionLabel(q)}`);

  if (showBack) {
    lines.push(`${BACK_TO_MAIN_OPTION}. Volver al menú principal`);
  }

  return `${header}\n\n${lines.join("\n")}`;
}

/**
 * Acepta el número de la opción o el texto exacto (nombre o
 * descripción, sin distinguir mayúsculas).
 */
function matchOption(text: string, options: ChatQueue[]): ChatQueue | null {

  const normalized = text.trim().toLowerCase();
  const asNumber = parseInt(normalized, 10);

  if (String(asNumber) === normalized && asNumber >= 1 && asNumber <= options.length) {
    return options[asNumber - 1];
  }

  return options.find(
    (q) => q.name.toLowerCase() === normalized || optionLabel(q).toLowerCase() === normalized
  ) ?? null;
}

function formatDateTime(value: unknown): string {

  const date = value instanceof Date ? value : new Date(String(value));

  if (isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString("es-SV", {
    timeZone: CHAT_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatAgo(value: unknown): string {

  const date = value instanceof Date ? value : new Date(String(value));
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);

  if (isNaN(minutes)) return "";
  if (minutes < 60) return `hace ${minutes} min`;
  if (minutes < 48 * 60) return `hace ${Math.floor(minutes / 60)} h`;
  return `hace ${Math.floor(minutes / (24 * 60))} días`;
}

function mapsLink(latitude: unknown, longitude: unknown): string | null {

  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
    return null;
  }

  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

/**
 * Texto del bot para un resultado del motor de consultas. Los
 * warnings del motor son técnicos (fallback a 3DT, etc.) y no se le
 * muestran al cliente.
 */
export function formatQueryResult(result: QueryEngineResult): string {

  if (result.source === "forbidden" || result.source === "not_found" || !result.data) {
    return result.message;
  }

  if (result.domain === "combustible") {

    const d = result.data as {
      unit: { fuelLevel: unknown; fuelLevelAt: Date | null; lastPositionAt: Date | null } | null;
      alerts: Array<Record<string, unknown>>;
      limit: number;
      periodLabel: string | null;
    };

    const lines = [`${result.message}:`];

    if (d.unit) {

      if (d.unit.fuelLevel !== null && d.unit.fuelLevel !== undefined && d.unit.fuelLevelAt) {
        lines.push(`• Nivel: ${d.unit.fuelLevel} gal — lectura ${formatDateTime(d.unit.fuelLevelAt)} (${formatAgo(d.unit.fuelLevelAt)})`);
      } else {
        lines.push("• Nivel: sin lecturas de combustible registradas (la unidad podría no tener sensor de combustible)");
      }

      lines.push(
        d.unit.lastPositionAt
          ? `• Último reporte de la unidad: ${formatDateTime(d.unit.lastPositionAt)} (${formatAgo(d.unit.lastPositionAt)})`
          : "• Último reporte de la unidad: sin reportes registrados"
      );
    }

    const period = d.periodLabel ? ` (${d.periodLabel})` : "";

    if (d.alerts.length === 0) {
      lines.push(`Alertas de combustible${period}: ninguna registrada.`);
    } else {
      lines.push(`Últimas ${d.alerts.length} alerta(s) de combustible${period}:`);
      d.alerts.forEach((alert, index) => {
        const detail = typeof alert.description === "string" && !alert.description.includes("\n")
          ? ` — ${alert.description}`
          : "";
        lines.push(`${index + 1}. ${alert.alertTypeName} — ${alert.unitName || alert.unitUid} — ${formatDateTime(alert.occurredAt)}${detail}`);
      });
    }

    return lines.join("\n");
  }

  if (result.domain === "estado") {

    const d = result.data as {
      reporting: boolean;
      lastPositionAt: Date | null;
      ignition: string | null;
      speed: unknown;
      batteryLevel: unknown;
      latitude: unknown;
      longitude: unknown;
    };

    const lines = [`Estado de ${result.matchedUnit?.name}:`];

    lines.push(
      d.lastPositionAt
        ? `• Reportando: ${d.reporting ? "Sí" : "No"} — último reporte ${formatDateTime(d.lastPositionAt)} (${formatAgo(d.lastPositionAt)})`
        : "• Reportando: No — sin reportes registrados"
    );

    const suffix = d.reporting ? "" : " (al último reporte)";

    if (d.ignition) {
      lines.push(`• Motor: ${d.ignition === "on" ? "encendido" : d.ignition === "off" ? "apagado" : d.ignition}${suffix}`);
    }

    if (d.speed !== null && d.speed !== undefined) {
      lines.push(`• Velocidad: ${d.speed} km/h${suffix}`);
    }

    if (d.batteryLevel !== null && d.batteryLevel !== undefined) {
      lines.push(`• Batería: ${d.batteryLevel}%`);
    }

    const link = mapsLink(d.latitude, d.longitude);

    if (link) {
      lines.push(`• Ubicación: ${link}`);
    }

    return lines.join("\n");
  }

  if (result.domain === "ubicacion") {

    const d = result.data as {
      latitude: unknown;
      longitude: unknown;
      speed: unknown;
      lastPositionAt: unknown;
    };

    const lines = [result.message];

    if (d.lastPositionAt) {
      lines.push(`• Fecha: ${formatDateTime(d.lastPositionAt)} (${formatAgo(d.lastPositionAt)})`);
    }

    if (d.speed !== null && d.speed !== undefined) {
      lines.push(`• Velocidad: ${d.speed} km/h`);
    }

    const link = mapsLink(d.latitude, d.longitude);

    if (link) {
      lines.push(`• Mapa: ${link}`);
    }

    return lines.join("\n");
  }

  if (result.domain === "alertas" && Array.isArray(result.data)) {

    /** La cantidad ya la acotó el motor (default 5, tope 50 — ver
     * extractLimit en query-engine.service.ts). */
    const rows = (result.data as Array<Record<string, unknown>>).map((alert, index) =>
      result.source === "local"
        ? `${index + 1}. ${alert.alertTypeName} — ${alert.unitName || alert.unitUid} — ${formatDateTime(alert.occurredAt)}`
        : `${index + 1}. ${alert.AlertName || alert.AlertType} — ${alert.Vehicle} — ${alert.CreatedDate}`
    );

    return [result.message, ...rows].join("\n");
  }

  return result.message;
}

/**
 * Corre el texto por el motor de consultas con los permisos del
 * creador del ticket y, si es una consulta reconocida, deja la
 * respuesta del bot en el hilo (para "reporte", con el PDF adjunto).
 * Devuelve false si no es una consulta (dominio "desconocido") o si
 * el ticket no tiene creador conocido — el llamador decide qué hacer.
 */
async function replyToFleetQuery(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  ticket: ChatTicket,
  text: string
): Promise<boolean> {

  if (ticket.createdByUserId === null) {
    return false;
  }

  const creator = await prisma.user.findUnique({
    where: { id: ticket.createdByUserId },
    select: { id: true, username: true, role: true, active: true }
  });

  if (!creator || !creator.active) {
    return false;
  }

  const result = await routeQuery(prisma, tracking3d, {
    text,
    userId: creator.id,
    role: creator.role
  });

  if (result.domain === "desconocido") {
    return false;
  }

  if (result.domain === "envivo" && result.source === "local" && result.data) {

    const params = result.data as { unitId: number; minutes: number | null };

    /**
     * Datos no encontrados (pedido 2026-10-27): sin ninguna posición
     * no hay nada que mostrar — no se crea el link. Con la última
     * posición vieja, se crea igual pero se avisa.
     */
    const lastPosition = await prisma.position.findFirst({
      where: { unitId: params.unitId },
      orderBy: { recordedAt: "desc" },
      select: { recordedAt: true }
    });

    if (!lastPosition) {
      await addBotMessage(
        prisma,
        ticket.id,
        `No encontré posiciones registradas de ${result.matchedUnit?.name}, así que no hay nada que mostrar en un link en vivo. ` +
        "Revisá que el equipo GPS esté instalado y reportando."
      );
      return true;
    }

    const staleHours = (Date.now() - lastPosition.recordedAt.getTime()) / 3600000;
    const staleWarning = staleHours > 24
      ? `\nAtención: ${result.matchedUnit?.name} no reporta desde el ${formatDateTime(lastPosition.recordedAt)}; ` +
        "el mapa va a mostrar esa última posición hasta que vuelva a reportar."
      : "";

    const link = await createLiveShareLink(prisma, {
      unitId: params.unitId,
      minutes: params.minutes,
      ticketId: ticket.id,
      createdByUserId: creator.id,
      createdByUsername: creator.username
    });

    const hours = link.minutes >= 60 && link.minutes % 60 === 0 ? `${link.minutes / 60} h` : `${link.minutes} min`;

    await addBotMessage(
      prisma,
      ticket.id,
      `Seguimiento en vivo de ${result.matchedUnit?.name} (válido por ${hours}, hasta ${formatDateTime(link.expiresAt)}):\n` +
      `${link.url}\n` +
      "Cualquiera con este link puede ver la ubicación hasta que venza; compartilo solo con quien corresponda." +
      staleWarning
    );

    return true;
  }

  if (result.domain === "recorrido" && result.source === "local" && result.data) {
    await replyWithRoute(prisma, ticket, creator, result.data as { unitId: number; from: Date; to: Date });
    return true;
  }

  if (result.domain === "reporte" && result.source === "local" && result.data) {
    await replyWithReport(prisma, ticket.id, result.data as { unitId: number; from: Date; to: Date });
    return true;
  }

  await addBotMessage(prisma, ticket.id, formatQueryResult(result));

  return true;
}

/** Link del recorrido histórico: dura 24 h, el dato no cambia. */
const ROUTE_LINK_MINUTES = 24 * 60;

function formatDay(date: Date): string {
  return date.toLocaleDateString("es-SV", { timeZone: CHAT_TIMEZONE, day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Recorrido histórico: resumen en el chat + link al mapa (modo
 * histórico de LiveShareLink). Sin posiciones en el rango no se crea
 * link — se dice cuándo fue el último reporte, que es la respuesta
 * útil (caso real: Telefono Mauricio el 26/10 tenía 1 sola posición).
 */
async function replyWithRoute(
  prisma: PrismaClient,
  ticket: ChatTicket,
  creator: { id: number; username: string },
  params: { unitId: number; from: Date; to: Date }
): Promise<void> {

  const unit = await prisma.unit.findUnique({ where: { id: params.unitId }, select: { name: true } });
  const name = unit?.name ?? "la unidad";

  const sameDay = formatDay(params.from) === formatDay(params.to);
  const period = sameDay ? `del ${formatDay(params.from)}` : `del ${formatDay(params.from)} al ${formatDay(params.to)}`;

  const route = await getUnitTripsForRange(prisma, params.unitId, params.from, params.to);

  if (route.positionsChecked === 0) {

    const lastBefore = await prisma.position.findFirst({
      where: { unitId: params.unitId, recordedAt: { lt: params.from } },
      orderBy: { recordedAt: "desc" },
      select: { recordedAt: true }
    });

    await addBotMessage(
      prisma,
      ticket.id,
      `No hay posiciones registradas de ${name} ${period}; no reportó en ese período.` +
      (lastBefore ? ` Su último reporte anterior: ${formatDateTime(lastBefore.recordedAt)}` : "")
    );
    return;
  }

  const km = route.trips.reduce((sum, t) => sum + (t.distanceKm ?? 0), 0);
  const minutes = route.trips.reduce((sum, t) => sum + t.durationMinutes, 0);

  /**
   * Sin viajes: se aclara si el equipo casi no reportó (caso real,
   * Telefono Mauricio 26/10: un solo reporte a las 15:19 en la oficina
   * y nada más, confirmado contra 3Dtracking) — "no tuvo movimiento"
   * a secas hacía pensar que el sistema había perdido el recorrido.
   */
  let noTripsSummary = `${name} no tuvo viajes ${period}: reportó ${route.positionsChecked} posiciones, todas sin desplazamiento.`;

  if (route.trips.length === 0 && route.positionsChecked <= 3) {

    const reports = await prisma.position.findMany({
      where: { unitId: params.unitId, recordedAt: { gte: params.from, lte: params.to } },
      orderBy: { recordedAt: "asc" },
      select: { recordedAt: true }
    });

    const times = reports
      .map((r) => r.recordedAt.toLocaleTimeString("es-SV", { timeZone: CHAT_TIMEZONE, hour: "2-digit", minute: "2-digit" }))
      .join(", ");

    const lastEver = await prisma.position.findFirst({
      where: { unitId: params.unitId },
      orderBy: { recordedAt: "desc" },
      select: { recordedAt: true }
    });

    const count = route.positionsChecked === 1 ? "1 vez" : `${route.positionsChecked} veces`;

    noTripsSummary =
      `${name} casi no reportó ${period}: solo ${count} (${times}), sin desplazamiento. ` +
      "No hay recorrido porque el equipo no envió más posiciones; si se movió, revisá que el GPS o la aplicación de rastreo estén activos." +
      (lastEver ? ` Último reporte recibido: ${formatDateTime(lastEver.recordedAt)}` : "");
  }

  const summary = route.trips.length === 0
    ? noTripsSummary
    : `Recorrido de ${name} ${period}: ${route.trips.length} viaje(s), ${km.toFixed(1)} km aprox., ` +
      `${Math.floor(minutes / 60)} h ${minutes % 60} min en movimiento, velocidad máxima ${Math.round(route.maxSpeed)} km/h.`;

  const link = await createLiveShareLink(prisma, {
    unitId: params.unitId,
    minutes: ROUTE_LINK_MINUTES,
    ticketId: ticket.id,
    createdByUserId: creator.id,
    createdByUsername: creator.username,
    range: { from: params.from, to: params.to }
  });

  await addBotMessage(
    prisma,
    ticket.id,
    `${summary}\nVer en el mapa (válido 24 h): ${link.url}`
  );
}

/**
 * Genera el PDF (report-pdf.service.ts) y lo adjunta a un mensaje del
 * bot. Si algo falla, el bot lo dice en el hilo en vez de quedarse
 * callado — el error real queda en el log del llamador.
 */
async function replyWithReport(
  prisma: PrismaClient,
  ticketId: number,
  params: { unitId: number; from: Date; to: Date }
): Promise<void> {

  const unit = await prisma.unit.findUnique({
    where: { id: params.unitId },
    select: { id: true, externalId: true, name: true, plate: true, companyName: true }
  });

  if (!unit) {
    await addBotMessage(prisma, ticketId, "No pude generar el reporte: la unidad ya no existe.");
    return;
  }

  /**
   * Período sin posiciones ni alertas: se avisa en vez de mandar un PDF
   * vacío (pedido 2026-10-27, "cuando no se encuentren datos
   * solicitados, brindar mensaje").
   */
  const [positionCount, alertCount] = await Promise.all([
    prisma.position.count({ where: { unitId: unit.id, recordedAt: { gte: params.from, lte: params.to } } }),
    prisma.criticalAlertEvent.count({ where: { unitUid: unit.externalId, occurredAt: { gte: params.from, lte: params.to } } })
  ]);

  if (positionCount === 0 && alertCount === 0) {

    const lastBefore = await prisma.position.findFirst({
      where: { unitId: unit.id, recordedAt: { lt: params.from } },
      orderBy: { recordedAt: "desc" },
      select: { recordedAt: true }
    });

    await addBotMessage(
      prisma,
      ticketId,
      `No encontré datos de ${unit.name} entre el ${formatDay(params.from)} y el ${formatDay(params.to)}: ` +
      "no reportó posiciones ni tiene alertas en ese período, así que no generé el PDF." +
      (lastBefore ? ` Su último reporte anterior: ${formatDateTime(lastBefore.recordedAt)}` : "")
    );
    return;
  }

  try {

    const report = await buildUnitReportPdf(prisma, unit, params.from, params.to);

    const message = await addBotMessage(
      prisma,
      ticketId,
      `${report.summary}\nDescargá el PDF adjunto.`
    );

    await prisma.chatAttachment.create({
      data: {
        ticketId,
        messageId: message.id,
        fileName: report.fileName,
        mimeType: "application/pdf",
        sizeBytes: report.buffer.length,
        data: new Uint8Array(report.buffer)
      }
    });

  } catch (error) {

    await addBotMessage(prisma, ticketId, "No pude generar el reporte en este momento. Intentá de nuevo en unos minutos.");

    throw error;
  }
}

async function addBotMessage(prisma: PrismaClient, ticketId: number, body: string) {
  return prisma.chatMessage.create({
    data: { ticketId, senderType: "bot", body }
  });
}

/**
 * Elegida una opción con destino agentes: queda en modo consulta con
 * esa cola recordada (botMenuQueueId) — ver handOffToAgent.
 */
async function transferToQueue(prisma: PrismaClient, ticket: ChatTicket, queue: ChatQueue) {

  const config = await getConfig(prisma);

  await prisma.chatTicket.update({
    where: { id: ticket.id },
    data: {
      botStatus: BOT_STATUS_SELF_SERVICE,
      botMenuQueueId: queue.id
    }
  });

  await addBotMessage(prisma, ticket.id, config.transferMessage.split("{cola}").join(queue.name));
}

/** El cliente pidió un agente: recién acá el ticket entra a la cola. */
async function handOffToAgent(prisma: PrismaClient, ticket: ChatTicket) {

  const queue = ticket.botMenuQueueId !== null
    ? await prisma.chatQueue.findUnique({ where: { id: ticket.botMenuQueueId } })
    : null;

  await prisma.chatTicket.update({
    where: { id: ticket.id },
    data: {
      queueId: queue?.id ?? null,
      botStatus: BOT_STATUS_TRANSFERRED,
      botMenuQueueId: null
    }
  });

  await addBotMessage(prisma, ticket.id, HANDOFF_MESSAGE.split("{cola}").join(queue?.name ?? "soporte"));

  await notifyAgentRequest(prisma, ticket, queue);
}

/**
 * Primer mensaje del ticket: saludo + menú principal. Si no hay
 * ninguna cola principal activa no hay nada que ofrecer — el ticket
 * queda sin cola (lo ven root/admin) y el bot no se activa.
 */
export async function startConversation(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  ticket: ChatTicket
): Promise<void> {

  const options = await getMenuOptions(prisma, null);

  if (options.length > 0) {

    const config = await getConfig(prisma);

    await prisma.chatTicket.update({
      where: { id: ticket.id },
      data: { botStatus: BOT_STATUS_MENU, botMenuQueueId: null }
    });

    await addBotMessage(prisma, ticket.id, formatMenu(config.greeting, options, false));
  }

  /** Si el primer mensaje ya es una consulta ("estado de X"), se
   * responde enseguida, debajo del saludo. */
  await replyToFleetQuery(prisma, tracking3d, ticket, ticket.description);
}

/**
 * Mensaje del cliente (ya guardado por el llamador). Fuera del menú
 * solo se responden consultas de flota reconocidas; en el menú, una
 * opción válida manda sobre la consulta (un "1" nunca es consulta).
 */
export async function handleClientMessage(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  ticket: ChatTicket,
  text: string
): Promise<void> {

  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

  if (ticket.botStatus === BOT_STATUS_SELF_SERVICE) {

    if (AGENT_REQUEST_PATTERN.test(normalized)) {
      await handOffToAgent(prisma, ticket);
      return;
    }

    if (MENU_REQUEST_PATTERN.test(normalized)) {

      const config = await getConfig(prisma);
      const mainOptions = await getMenuOptions(prisma, null);

      await prisma.chatTicket.update({
        where: { id: ticket.id },
        data: { botStatus: BOT_STATUS_MENU, botMenuQueueId: null }
      });

      await addBotMessage(prisma, ticket.id, formatMenu(config.greeting, mainOptions, false));
      return;
    }

    if (!(await replyToFleetQuery(prisma, tracking3d, ticket, text))) {
      await replyToUnrecognized(prisma, ticket, normalized, SELF_SERVICE_HINT);
    }

    return;
  }

  if (ticket.botStatus !== BOT_STATUS_MENU) {

    if (!(await replyToFleetQuery(prisma, tracking3d, ticket, text))) {
      await replyToUnrecognized(prisma, ticket, normalized, UNRECOGNIZED_WAITING_MESSAGE);
    }

    return;
  }

  const config = await getConfig(prisma);
  const currentParentId = ticket.botMenuQueueId;

  if (currentParentId !== null && text.trim() === BACK_TO_MAIN_OPTION) {

    const mainOptions = await getMenuOptions(prisma, null);

    await prisma.chatTicket.update({
      where: { id: ticket.id },
      data: { botMenuQueueId: null }
    });

    await addBotMessage(prisma, ticket.id, formatMenu(config.greeting, mainOptions, false));

    return;
  }

  const options = await getMenuOptions(prisma, currentParentId);
  const selected = matchOption(text, options);

  if (!selected) {

    if (await replyToFleetQuery(prisma, tracking3d, ticket, text)) {
      await addBotMessage(
        prisma,
        ticket.id,
        formatMenu("Si necesitás hablar con un agente, elegí una opción:", options, currentParentId !== null)
      );
      return;
    }

    await addBotMessage(
      prisma,
      ticket.id,
      formatMenu(config.invalidOption, options, currentParentId !== null)
    );
    return;
  }

  if (selected.destination === "cola") {

    const children = await getMenuOptions(prisma, selected.id);

    /**
     * Una cola "cola" sin hijas activas no tiene a dónde llevar al
     * cliente — se trata como destino agentes en esa misma cola (la
     * del último mensaje) en vez de dejarlo en un menú vacío.
     */
    if (children.length === 0) {
      await transferToQueue(prisma, ticket, selected);
      return;
    }

    await prisma.chatTicket.update({
      where: { id: ticket.id },
      data: { botMenuQueueId: selected.id }
    });

    await addBotMessage(prisma, ticket.id, formatMenu(optionLabel(selected), children, true));

    return;
  }

  await transferToQueue(prisma, ticket, selected);
}
