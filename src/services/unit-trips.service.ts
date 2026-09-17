import { PrismaClient } from "@prisma/client";

import { Tracking3DService } from "../integrations/3dtracking/tracking.service";
import { Tracking3DPositionListEntry } from "../integrations/3dtracking/tracking.types";

export interface TripPoint {
  lat: number;
  lng: number;
  time: string;
  speed: number;
}

export interface Trip {
  startTime: string;
  endTime: string;
  startAddress: string | null;
  endAddress: string | null;
  distanceKm: number | null;
  durationMinutes: number;
  points: TripPoint[];
}

export interface UnitTripsResult {
  date: string;
  positionsChecked: number;
  truncated: boolean;
  trips: Trip[];
}

const MAX_PAGES = 60;
const STOP_GAP_MINUTES = 5;
const MOVING_SPEED_THRESHOLD = 2;

function toTime(position: Tracking3DPositionListEntry): number {
  const raw = position.GPSTimeUtc || position.ServerTimeUTC;
  return raw ? new Date(raw).getTime() : 0;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateDistanceKm(points: Tracking3DPositionListEntry[]): number | null {
  const first = points[0];
  const last = points[points.length - 1];

  if (first.Odometer != null && last.Odometer != null && last.Odometer >= first.Odometer) {
    return Math.round((last.Odometer - first.Odometer) * 10) / 10;
  }

  let total = 0;

  for (let i = 1; i < points.length; i++) {
    total += haversineKm(
      points[i - 1].Latitude,
      points[i - 1].Longitude,
      points[i].Latitude,
      points[i].Longitude
    );
  }

  return Math.round(total * 10) / 10;
}

/**
 * 3Dtracking no tiene un endpoint de "viajes/recorridos" — se arma
 * acá agrupando el historial de posiciones del día (Data/PositionsList
 * filtrado por Uid de la unidad) en tramos de movimiento continuo,
 * separados por paradas de STOP_GAP_MINUTES o más. Es un cálculo
 * bajo demanda (no se guarda nada), pensado para "ver los viajes de
 * hoy" al hacer clic en una unidad — no para reportes históricos
 * masivos.
 *
 * El filtro por Uid en Data/PositionsList sí reduce la respuesta al
 * tamaño real (confirmado con datos reales: ~267ms, solo las
 * posiciones de esa unidad), pero el cursor (StartId) sigue siendo
 * global — cada página recorre el stream completo de la cuenta antes
 * de filtrar, así que ponerse al día hasta la fecha pedida puede
 * tomar varias páginas.
 */
export async function getUnitTripsForDate(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  unitExternalId: string,
  dateStr: string
): Promise<UnitTripsResult> {

  const todayStr = new Date().toISOString().slice(0, 10);
  const daysAgo = Math.round(
    (new Date(`${todayStr}T00:00:00Z`).getTime() - new Date(`${dateStr}T00:00:00Z`).getTime()) /
      86400000
  );

  let cursor: string | undefined = daysAgo > 1 ? "0" : undefined;

  const matching: Tracking3DPositionListEntry[] = [];
  let totalChecked = 0;
  let truncated = false;

  for (let page = 0; page < MAX_PAGES; page++) {

    let raw: any;

    try {

      raw = await tracking3d.getPositionsList({
        startId: cursor,
        uid: unitExternalId
      });

    } catch (error) {

      /**
       * Data/PositionsList comparte cuota de límite de tasa con los
       * schedulers en segundo plano (alertas críticas + batería/
       * transmisión) — confirmado en pruebas reales que un click acá
       * puede toparse con 429 a mitad de la paginación. En vez de
       * fallar toda la consulta, se devuelven los viajes ya calculados
       * con los datos obtenidos hasta ese punto (truncated: true) —
       * mejor un resultado parcial que nada.
       */
      if (error instanceof Error && error.message.includes("Rate limit")) {
        truncated = true;
        break;
      }

      throw error;
    }

    const positions: Tracking3DPositionListEntry[] = raw?.Result?.Position || [];
    const newStartId: string | undefined =
      raw?.Result?.StartId !== undefined && raw?.Result?.StartId !== null
        ? String(raw.Result.StartId)
        : undefined;

    totalChecked += positions.length;

    for (const position of positions) {
      const localDate = (position.GPSTimeLocal || "").slice(0, 10);

      if (localDate === dateStr) {
        matching.push(position);
      }
    }

    const lastLocalDate = positions.length
      ? (positions[positions.length - 1].GPSTimeLocal || "").slice(0, 10)
      : null;

    if (!newStartId || newStartId === cursor || positions.length === 0) {
      break;
    }

    cursor = newStartId;

    if (lastLocalDate && lastLocalDate > dateStr) {
      break;
    }
  }

  matching.sort((a, b) => toTime(a) - toTime(b));

  const trips: Trip[] = [];
  let current: Tracking3DPositionListEntry[] = [];
  let firstStopAt: number | null = null;

  const closeTrip = () => {
    if (current.length < 2) {
      current = [];
      firstStopAt = null;
      return;
    }

    const start = current[0];
    const end = current[current.length - 1];

    trips.push({
      startTime: start.GPSTimeUtc || start.ServerTimeUTC || "",
      endTime: end.GPSTimeUtc || end.ServerTimeUTC || "",
      startAddress: start.Address,
      endAddress: end.Address,
      distanceKm: estimateDistanceKm(current),
      durationMinutes: Math.round((toTime(end) - toTime(start)) / 60000),
      points: current.map((p) => ({
        lat: p.Latitude,
        lng: p.Longitude,
        time: p.GPSTimeUtc || p.ServerTimeUTC || "",
        speed: p.Speed
      }))
    });

    current = [];
    firstStopAt = null;
  };

  for (const position of matching) {
    const moving = position.Speed > MOVING_SPEED_THRESHOLD;

    if (moving) {
      current.push(position);
      firstStopAt = null;
      continue;
    }

    if (current.length === 0) {
      continue;
    }

    const time = toTime(position);

    if (firstStopAt === null) {
      firstStopAt = time;
    }

    current.push(position);

    if (time - firstStopAt >= STOP_GAP_MINUTES * 60000) {
      closeTrip();
    }
  }

  closeTrip();

  return {
    date: dateStr,
    positionsChecked: totalChecked,
    truncated,
    trips
  };
}
