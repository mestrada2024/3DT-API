import { PrismaClient } from "@prisma/client";

import { Tracking3DService } from "../integrations/3dtracking/tracking.service";

const MAX_PAGES = 300;
const PAGE_DELAY_MS = 150;
const HARSH_BRAKING_SYSTEM_NAME = "excessivedeceleration";

/**
 * IDs por día del stream global de posiciones (compartido por TODA la
 * cuenta, no por unidad — ver project memory sobre las limitaciones
 * de paginación de Data/PositionsList). Calibrado empíricamente con
 * dos puntos reales el 2026-09-22 (~20.4M IDs/día) — es una
 * aproximación que puede desviarse si cambia el tráfico general de la
 * cuenta; se usa solo para estimar un StartId de arranque razonable,
 * nunca para filtrar resultados (el filtro real es por fecha/hora de
 * cada posición).
 */
const ESTIMATED_IDS_PER_DAY = 20_400_000;
const START_ID_SAFETY_MARGIN = 1.15;

export interface HarshBrakingEvent {
  unitUid: string;
  unitName: string | null;
  occurredAtUtc: string;
  occurredAtLocal: string | null;
  speed: number;
  speedMeasure: string | null;
  heading: number;
  ignition: string | null;
  odometer: number | null;
  latitude: number;
  longitude: number;
  address: string | null;
  driverName: string | null;
  description: string | null;
}

export interface HarshBrakingReportResult {
  from: string;
  to: string;
  unitsRequested: string[];
  positionsChecked: number;
  pagesProcessed: number;
  truncated: boolean;
  events: HarshBrakingEvent[];
}

/**
 * Reporte de frenado brusco (InputOutputs.SystemName="excessivedeceleration"
 * en Data/PositionsList) para una empresa, en un rango de fecha/hora,
 * opcionalmente acotado a unidades específicas.
 *
 * Mismo mecanismo que el reporte manual verificado el 2026-09-22 para
 * PRODUCTOS DIANA: un solo recorrido del stream global (sin filtro
 * Uid — cubrir varias unidades en una sola pasada es mucho más barato
 * que una pasada por unidad, ver ese hallazgo en el historial), con
 * un StartId de arranque estimado a partir de UnitLiveStatusCursor
 * (referencia de "ahora" que ya mantiene el scheduler en vivo) menos
 * los días hacia atrás que pide el rango, con margen de seguridad.
 *
 * Puede tardar varios minutos en rangos de varios días — MAX_PAGES
 * acota la corrida; si se alcanza el límite o 3Dtracking responde
 * límite de tasa, se devuelve lo encontrado hasta ese punto con
 * truncated=true en vez de fallar todo el reporte.
 */
export async function getHarshBrakingReport(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  companyUid: string,
  from: Date,
  to: Date,
  unitExternalIds?: string[]
): Promise<HarshBrakingReportResult> {

  const companyUnits = await prisma.unit.findMany({
    where: { companyUid },
    select: { externalId: true, name: true }
  });

  const targetUnits = unitExternalIds && unitExternalIds.length > 0
    ? companyUnits.filter((u) => unitExternalIds.includes(u.externalId))
    : companyUnits;

  const targetUnitUids = new Set(targetUnits.map((u) => u.externalId));

  const result: HarshBrakingReportResult = {
    from: from.toISOString(),
    to: to.toISOString(),
    unitsRequested: [...targetUnitUids],
    positionsChecked: 0,
    pagesProcessed: 0,
    truncated: false,
    events: []
  };

  if (targetUnitUids.size === 0) {
    return result;
  }

  const cursor = await prisma.unitLiveStatusCursor.findUnique({
    where: { id: 1 },
    select: { positionsStartId: true }
  });

  const nowCursor = cursor?.positionsStartId ? Number(cursor.positionsStartId) : null;

  const daysBack = Math.max((Date.now() - from.getTime()) / 86_400_000, 0);

  let startId: string | undefined = nowCursor
    ? String(Math.max(
        Math.floor(nowCursor - daysBack * ESTIMATED_IDS_PER_DAY * START_ID_SAFETY_MARGIN),
        0
      ))
    : undefined;

  const fromMs = from.getTime();
  const toMs = to.getTime();

  for (let page = 0; page < MAX_PAGES; page++) {

    let raw: any;

    try {

      raw = await tracking3d.getPositionsList({ startId, includeInputOutputs: true });

    } catch (error) {

      if (error instanceof Error && error.message.includes("Rate limit")) {
        result.truncated = true;
        break;
      }

      throw error;
    }

    const positions = raw?.Result?.Position || [];
    const newStartId: string | undefined =
      raw?.Result?.StartId !== undefined && raw?.Result?.StartId !== null
        ? String(raw.Result.StartId)
        : undefined;

    result.pagesProcessed++;
    result.positionsChecked += positions.length;

    for (const position of positions) {

      const uid = position.Unit?.Uid;

      if (!uid || !targetUnitUids.has(uid)) {
        continue;
      }

      const occurredAtRaw = position.GPSTimeUtc || position.ServerTimeUTC;

      if (!occurredAtRaw) {
        continue;
      }

      const occurredAtMs = new Date(occurredAtRaw).getTime();

      if (isNaN(occurredAtMs) || occurredAtMs < fromMs || occurredAtMs > toMs) {
        continue;
      }

      for (const io of position.InputOutputs || []) {

        if (io.SystemName !== HARSH_BRAKING_SYSTEM_NAME || !io.Active) {
          continue;
        }

        result.events.push({
          unitUid: uid,
          unitName: position.Unit?.Name || null,
          occurredAtUtc: occurredAtRaw,
          occurredAtLocal: position.GPSTimeLocal || null,
          speed: position.Speed,
          speedMeasure: position.SpeedMeasure || null,
          heading: position.Heading,
          ignition: position.Ignition || null,
          odometer: position.Odometer ?? null,
          latitude: position.Latitude,
          longitude: position.Longitude,
          address: position.Address || null,
          driverName: position.Driver
            ? [position.Driver.FirstName, position.Driver.LastName].filter(Boolean).join(" ") || position.Driver.Code || null
            : null,
          description: io.UserDescription || io.Description || null
        });
      }
    }

    const lastPosition = positions[positions.length - 1];
    const lastTimeMs = lastPosition
      ? new Date(lastPosition.GPSTimeUtc || lastPosition.ServerTimeUTC).getTime()
      : null;

    if (!newStartId || newStartId === startId || positions.length === 0) {
      break;
    }

    startId = newStartId;

    if (lastTimeMs && lastTimeMs > toMs) {
      break;
    }

    if (page < MAX_PAGES - 1) {
      await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
    }
  }

  if (result.pagesProcessed >= MAX_PAGES) {
    result.truncated = true;
  }

  result.events.sort((a, b) => new Date(a.occurredAtUtc).getTime() - new Date(b.occurredAtUtc).getTime());

  return result;
}
