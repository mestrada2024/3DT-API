import { randomBytes } from "crypto";
import { PrismaClient } from "@prisma/client";

import { getUnitTripsForRange } from "./unit-trips.service";

/**
 * Links efímeros de seguimiento en vivo (pedido 2026-10-27): quien
 * tiene el link ve el recorrido de UNA unidad, sin login, hasta que
 * vence o se revoca. Lo crea el chatbot (o POST /live-links) con los
 * permisos de quien lo pide; la página pública solo lee la tabla
 * Position local — nunca llama a 3Dtracking, así que muchos visores
 * no suman consultas a la API externa. La frescura la da
 * unit-live-status-scheduler (UNIT_LIVE_STATUS_SYNC_INTERVAL_SECONDS).
 */

export const DEFAULT_LINK_MINUTES = 60;
export const MIN_LINK_MINUTES = 5;
export const MAX_LINK_MINUTES = 24 * 60;

/** Puntos máximos por respuesta: el recorrido del día de una unidad
 * que reporta cada ~6s ronda los 10k puntos; más que esto no aporta
 * en el mapa y pesa en el teléfono. Se queda con los más recientes. */
const MAX_POINTS = 5000;

const PUBLIC_APP_URL = (process.env.PUBLIC_APP_URL || "https://dada-fleet.dms-smart.cloud").replace(/\/+$/, "");

const SV_UTC_OFFSET_HOURS = -6;

export function liveLinkUrl(token: string): string {
  return `${PUBLIC_APP_URL}/en-vivo/${token}`;
}

export function clampLinkMinutes(minutes: number | null | undefined): number {
  if (!minutes || isNaN(minutes)) return DEFAULT_LINK_MINUTES;
  return Math.min(Math.max(Math.round(minutes), MIN_LINK_MINUTES), MAX_LINK_MINUTES);
}

export async function createLiveShareLink(
  prisma: PrismaClient,
  params: {
    unitId: number;
    minutes?: number | null;
    ticketId?: number | null;
    createdByUserId: number | null;
    createdByUsername: string | null;
    /** Con rango: recorrido histórico de ese período, no en vivo. */
    range?: { from: Date; to: Date } | null;
  }
) {

  const minutes = clampLinkMinutes(params.minutes);

  const link = await prisma.liveShareLink.create({
    data: {
      token: randomBytes(24).toString("base64url"),
      unitId: params.unitId,
      ticketId: params.ticketId ?? null,
      createdByUserId: params.createdByUserId,
      createdByUsername: params.createdByUsername,
      expiresAt: new Date(Date.now() + minutes * 60000),
      rangeFrom: params.range?.from ?? null,
      rangeTo: params.range?.to ?? null
    }
  });

  return { ...link, minutes, url: liveLinkUrl(link.token) };
}

export type PublicLiveResult =
  | { status: "not_found" }
  | { status: "expired" }
  | {
      status: "ok";
      data: {
        /** "envivo": recorrido de hoy + polling; "historico": rango fijo. */
        mode: "envivo" | "historico";
        rangeFrom: Date | null;
        rangeTo: Date | null;
        unit: { name: string; plate: string | null };
        expiresAt: Date;
        serverTime: Date;
        lastPosition: {
          latitude: number;
          longitude: number;
          speed: number | null;
          ignition: string | null;
          recordedAt: Date;
        } | null;
        /** [lat, lng, velocidad, epoch ms] — compacto para el polling. */
        points: Array<[number, number, number, number]>;
        truncated: boolean;
        /** Solo modo histórico: viajes del período, mismo corte que el
         * reporte PDF (getUnitTripsForRange). */
        trips: Array<{
          startTime: string;
          endTime: string;
          distanceKm: number;
          durationMinutes: number;
          maxSpeed: number;
          points: Array<[number, number, number, number]>;
        }>;
      };
    };

/** Medianoche de hoy en hora de El Salvador, como instante UTC. */
function startOfTodaySv(): Date {
  const local = new Date(Date.now() + SV_UTC_OFFSET_HOURS * 3600000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), -SV_UTC_OFFSET_HOURS));
}

/**
 * Datos de la página pública. Sin `since`: el recorrido de hoy (hora
 * SV). Con `since` (epoch ms del último punto que ya tiene la
 * página): solo los puntos nuevos. Vencido/revocado → "expired", sin
 * datos de la unidad.
 */
export async function getPublicLiveData(
  prisma: PrismaClient,
  token: string,
  sinceMs: number | null
): Promise<PublicLiveResult> {

  const link = await prisma.liveShareLink.findUnique({ where: { token } });

  if (!link) {
    return { status: "not_found" };
  }

  const now = new Date();

  if (link.revokedAt || link.expiresAt <= now) {
    return { status: "expired" };
  }

  const unit = await prisma.unit.findUnique({
    where: { id: link.unitId },
    select: { name: true, plate: true }
  });

  if (!unit) {
    return { status: "not_found" };
  }

  if (link.rangeFrom && link.rangeTo) {
    return getHistoricData(prisma, link.unitId, unit, link.expiresAt, link.rangeFrom, link.rangeTo, now);
  }

  const dayStart = startOfTodaySv();
  const from = sinceMs !== null && sinceMs > dayStart.getTime() ? new Date(sinceMs) : dayStart;

  const rows = await prisma.position.findMany({
    where: {
      unitId: link.unitId,
      recordedAt: sinceMs !== null ? { gt: from } : { gte: from }
    },
    orderBy: { recordedAt: "desc" },
    take: MAX_POINTS + 1,
    select: { latitude: true, longitude: true, speed: true, ignition: true, recordedAt: true }
  });

  const truncated = rows.length > MAX_POINTS;
  const ordered = rows.slice(0, MAX_POINTS).reverse();

  /** Última posición conocida aunque no haya reportado hoy, para que
   * el mapa no quede vacío si la unidad está apagada desde ayer. */
  const last = ordered[ordered.length - 1] ?? (sinceMs === null
    ? await prisma.position.findFirst({
        where: { unitId: link.unitId },
        orderBy: { recordedAt: "desc" },
        select: { latitude: true, longitude: true, speed: true, ignition: true, recordedAt: true }
      })
    : null);

  return {
    status: "ok",
    data: {
      mode: "envivo",
      rangeFrom: null,
      rangeTo: null,
      unit,
      expiresAt: link.expiresAt,
      serverTime: now,
      lastPosition: last
        ? {
            latitude: Number(last.latitude),
            longitude: Number(last.longitude),
            speed: last.speed !== null ? Number(last.speed) : null,
            ignition: last.ignition,
            recordedAt: last.recordedAt
          }
        : null,
      points: ordered.map((p) => [
        Number(p.latitude),
        Number(p.longitude),
        p.speed !== null ? Number(p.speed) : 0,
        p.recordedAt.getTime()
      ]),
      truncated,
      trips: []
    }
  };
}

/**
 * Recorrido histórico: todos los puntos del rango, en orden. Si son
 * más de MAX_POINTS (7 días de una unidad que reporta cada ~6s pasan
 * de 100k), se toma uno de cada N parejo a lo largo del período —
 * a diferencia del modo en vivo, que se queda con los más recientes —
 * conservando siempre el primero y el último.
 */
async function getHistoricData(
  prisma: PrismaClient,
  unitId: number,
  unit: { name: string; plate: string | null },
  expiresAt: Date,
  from: Date,
  to: Date,
  now: Date
): Promise<PublicLiveResult> {

  const rows = await prisma.position.findMany({
    where: { unitId, recordedAt: { gte: from, lte: to } },
    orderBy: { recordedAt: "asc" },
    select: { latitude: true, longitude: true, speed: true, ignition: true, recordedAt: true }
  });

  const truncated = rows.length > MAX_POINTS;
  const step = truncated ? Math.ceil(rows.length / MAX_POINTS) : 1;
  const sampled = truncated
    ? rows.filter((_, i) => i % step === 0 || i === rows.length - 1)
    : rows;

  const last = rows[rows.length - 1] ?? null;

  /**
   * Viajes del período, como en Rastreo (pedido 2026-10-27: "debería
   * mostrar todos los recorridos del día, al igual que en rastreo").
   * Si entre todos superan MAX_POINTS, se muestrea cada viaje con el
   * mismo paso para no cargar el teléfono.
   */
  const route = await getUnitTripsForRange(prisma, unitId, from, to);
  const tripPointsTotal = route.trips.reduce((sum, t) => sum + t.points.length, 0);
  const tripStep = tripPointsTotal > MAX_POINTS ? Math.ceil(tripPointsTotal / MAX_POINTS) : 1;

  const trips = route.trips.map((trip) => ({
    startTime: trip.startTime,
    endTime: trip.endTime,
    distanceKm: trip.distanceKm ?? 0,
    durationMinutes: trip.durationMinutes,
    maxSpeed: Math.round(trip.points.reduce((max, p) => Math.max(max, p.speed), 0)),
    points: trip.points
      .filter((_, i) => i % tripStep === 0 || i === trip.points.length - 1)
      .map((p): [number, number, number, number] => [p.lat, p.lng, p.speed, new Date(p.time).getTime()])
  }));

  return {
    status: "ok",
    data: {
      mode: "historico",
      rangeFrom: from,
      rangeTo: to,
      unit,
      expiresAt,
      serverTime: now,
      lastPosition: last
        ? {
            latitude: Number(last.latitude),
            longitude: Number(last.longitude),
            speed: last.speed !== null ? Number(last.speed) : null,
            ignition: last.ignition,
            recordedAt: last.recordedAt
          }
        : null,
      points: sampled.map((p) => [
        Number(p.latitude),
        Number(p.longitude),
        p.speed !== null ? Number(p.speed) : 0,
        p.recordedAt.getTime()
      ]),
      truncated,
      trips
    }
  };
}
