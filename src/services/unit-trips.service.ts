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

/**
 * Forma común para armar viajes sin importar la fuente (3Dtracking en
 * vivo o historial local en Position) — evita duplicar la lógica de
 * segmentación de tramos dos veces.
 */
interface RawTripPoint {
  lat: number;
  lng: number;
  speed: number;
  timeMs: number;
  timeIso: string;
  address: string | null;
  odometer: number | null;
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

function estimateDistanceKm(points: RawTripPoint[]): number | null {
  const first = points[0];
  const last = points[points.length - 1];

  if (first.odometer != null && last.odometer != null && last.odometer >= first.odometer) {
    return Math.round((last.odometer - first.odometer) * 10) / 10;
  }

  let total = 0;

  for (let i = 1; i < points.length; i++) {
    total += haversineKm(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  }

  return Math.round(total * 10) / 10;
}

/**
 * Agrupa puntos cronológicos en tramos de movimiento continuo
 * (velocidad > MOVING_SPEED_THRESHOLD), cerrando un viaje tras
 * STOP_GAP_MINUTES o más de paradas seguidas. Fuente-agnóstico —
 * tanto el fetch en vivo como el histórico local pasan por acá.
 */
function buildTripsFromPoints(points: RawTripPoint[]): Trip[] {
  const trips: Trip[] = [];
  let current: RawTripPoint[] = [];
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
      startTime: start.timeIso,
      endTime: end.timeIso,
      startAddress: start.address,
      endAddress: end.address,
      distanceKm: estimateDistanceKm(current),
      durationMinutes: Math.round((end.timeMs - start.timeMs) / 60000),
      points: current.map((p) => ({
        lat: p.lat,
        lng: p.lng,
        time: p.timeIso,
        speed: p.speed
      }))
    });

    current = [];
    firstStopAt = null;
  };

  for (const point of points) {
    const moving = point.speed > MOVING_SPEED_THRESHOLD;

    if (moving) {
      current.push(point);
      firstStopAt = null;
      continue;
    }

    if (current.length === 0) {
      continue;
    }

    if (firstStopAt === null) {
      firstStopAt = point.timeMs;
    }

    current.push(point);

    if (point.timeMs - firstStopAt >= STOP_GAP_MINUTES * 60000) {
      closeTrip();
    }
  }

  closeTrip();

  return trips;
}

function toRawPoint(position: Tracking3DPositionListEntry): RawTripPoint | null {
  const raw = position.GPSTimeUtc || position.ServerTimeUTC;

  if (!raw) {
    return null;
  }

  return {
    lat: position.Latitude,
    lng: position.Longitude,
    speed: position.Speed,
    timeMs: new Date(raw).getTime(),
    timeIso: raw,
    address: position.Address ?? null,
    odometer: position.Odometer ?? null
  };
}

/**
 * "Hoy" se sigue consultando en vivo contra 3Dtracking
 * (Data/PositionsList, sin StartId — 3Dtracking devuelve ~últimas
 * 24h por defecto, que cubren de sobra lo transcurrido del día).
 * 3Dtracking no tiene endpoint de "viajes/recorridos" — se arma acá
 * agrupando ese historial de posiciones.
 */
async function getTripsFromLive3DT(
  tracking3d: Tracking3DService,
  unitExternalId: string,
  dateStr: string
): Promise<UnitTripsResult> {

  let cursor: string | undefined;
  const matching: RawTripPoint[] = [];
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
      /**
       * Se agrupa por fecha UTC (GPSTimeUtc/ServerTimeUTC), no por
       * GPSTimeLocal — mismo criterio que el historial local
       * (getTripsFromLocalHistory) y el filtro de fecha del Dashboard
       * (dashboard.ts, rango en T00:00:00.000Z/T23:59:59.999Z). Antes
       * esta ruta agrupaba por GPSTimeLocal (hora de El Salvador,
       * UTC-6) mientras las otras dos usaban UTC — cerca de
       * medianoche, el mismo punto podía caer en "hoy" para una
       * fuente y en "ayer" para otra.
       */
      const utcDate = (position.GPSTimeUtc || position.ServerTimeUTC || "").slice(0, 10);

      if (utcDate === dateStr) {
        const point = toRawPoint(position);
        if (point) matching.push(point);
      }
    }

    /**
     * Con filtro Uid, una página puede legítimamente traer 0
     * coincidencias para esta unidad sin que eso signifique que se
     * acabó el stream (el cursor sigue siendo global, no por unidad —
     * ver comentario de arriba). Antes se cortaba acá mismo con
     * positions.length === 0, perdiendo el resto de páginas donde sí
     * había datos. Solo se corta si el cursor deja de avanzar.
     */
    if (!newStartId || newStartId === cursor) {
      break;
    }

    cursor = newStartId;
  }

  matching.sort((a, b) => a.timeMs - b.timeMs);

  return {
    date: dateStr,
    positionsChecked: totalChecked,
    truncated,
    trips: buildTripsFromPoints(matching)
  };
}

/**
 * Cualquier fecha que no sea "hoy" se arma desde el historial local
 * en Position (ver unit-live-status.service.ts) en vez de volver a
 * consultar 3Dtracking. Data/PositionsList pagina por un StartId
 * GLOBAL (compartido por todas las unidades de la cuenta) — con
 * filtro Uid, confirmado con datos reales que llegar desde StartId=0
 * hasta el rango de una unidad específica puede requerir *decenas de
 * miles* de páginas (el cursor global avanzó ~128 millones de IDs
 * entre "0" y "ahora" en una cuenta con tráfico normal), muy por
 * encima de cualquier límite de páginas razonable — por eso "ayer" no
 * mostraba viajes (la consulta se cortaba antes de encontrar datos).
 * El historial local no tiene esa limitación: es una consulta directa
 * por unitId + rango de fecha.
 *
 * Contrapartida: Position no guarda dirección (Address) ni odómetro,
 * así que startAddress/endAddress quedan null (el frontend ya lo
 * maneja) y la distancia se calcula por haversine en vez de odómetro.
 * Solo hay datos desde que se empezó a llenar esta tabla — fechas
 * anteriores a eso no van a tener viajes, sin importar la fuente.
 */
async function getTripsFromLocalHistory(
  prisma: PrismaClient,
  unitExternalId: string,
  dateStr: string
): Promise<UnitTripsResult> {

  const unit = await prisma.unit.findUnique({
    where: { externalId: unitExternalId },
    select: { id: true }
  });

  if (!unit) {
    return { date: dateStr, positionsChecked: 0, truncated: false, trips: [] };
  }

  const from = new Date(`${dateStr}T00:00:00.000Z`);
  const to = new Date(`${dateStr}T23:59:59.999Z`);

  const positions = await prisma.position.findMany({
    where: {
      unitId: unit.id,
      recordedAt: { gte: from, lte: to }
    },
    orderBy: { recordedAt: "asc" },
    select: { latitude: true, longitude: true, speed: true, recordedAt: true }
  });

  const points: RawTripPoint[] = positions.map((p) => ({
    lat: Number(p.latitude),
    lng: Number(p.longitude),
    speed: p.speed !== null ? Number(p.speed) : 0,
    timeMs: p.recordedAt.getTime(),
    timeIso: p.recordedAt.toISOString(),
    address: null,
    odometer: null
  }));

  return {
    date: dateStr,
    positionsChecked: points.length,
    truncated: false,
    trips: buildTripsFromPoints(points)
  };
}

export async function getUnitTripsForDate(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  unitExternalId: string,
  dateStr: string
): Promise<UnitTripsResult> {

  const todayStr = new Date().toISOString().slice(0, 10);

  if (dateStr === todayStr) {
    return getTripsFromLive3DT(tracking3d, unitExternalId, dateStr);
  }

  return getTripsFromLocalHistory(prisma, unitExternalId, dateStr);
}
