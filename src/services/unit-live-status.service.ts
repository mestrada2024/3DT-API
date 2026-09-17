import { PrismaClient } from "@prisma/client";

import { Tracking3DService } from "../integrations/3dtracking/tracking.service";
import { Tracking3DUnitLatestPosition } from "../integrations/3dtracking/tracking.types";

export interface UnitLiveStatusSyncResult {
  positionsChecked: number;
  updated: number;
  skipped: number;
}

/**
 * Actualiza, para cada unidad YA conocida localmente (creada vía
 * sync de catálogo o POST /units), su última posición/telemetría:
 * latitude/longitude/speed, lastPositionAt ("hora de transmisión",
 * de LastReportedTimeUTC) y batteryLevel (de SensorReadings, entrada
 * con SensorType "Batería" — confirmado con datos reales).
 *
 * Usa Units/LatestPositionsList (a diferencia del escaneo de alertas
 * críticas, que usa Data/PositionsList) porque es el único endpoint
 * que expone SensorReadings — no hace falta el detalle mensaje-por-
 * mensaje acá, solo el estado más reciente por unidad. Se corre en un
 * intervalo controlado (ver unit-live-status-scheduler.ts) para no
 * repetir el problema de límite de tasa ya visto con este mismo
 * endpoint cuando se llamaba con mucha frecuencia.
 *
 * Unidades que no existen aún localmente se ignoran (no crea filas
 * nuevas — Unit.externalId no admite valores parciales/sin los demás
 * campos requeridos; para eso está el sync de catálogo).
 */
export async function syncUnitLiveStatus(
  prisma: PrismaClient,
  tracking3d: Tracking3DService
): Promise<UnitLiveStatusSyncResult> {

  const raw = await tracking3d.getLatestPositions();
  const positions: Tracking3DUnitLatestPosition[] = raw?.Result || [];

  let updated = 0;
  let skipped = 0;

  for (const unit of positions) {

    const batteryReading = unit.SensorReadings?.find(
      (reading) => reading.SensorType === "Batería" || reading.Name === "Bateria"
    );

    const batteryLevel = batteryReading?.Value
      ? parseFloat(batteryReading.Value)
      : null;

    const lastPositionAt = unit.LastReportedTimeUTC
      ? new Date(unit.LastReportedTimeUTC)
      : null;

    try {

      await prisma.unit.update({
        where: { externalId: unit.Uid },
        data: {
          latitude: unit.Position?.Latitude ?? null,
          longitude: unit.Position?.Longitude ?? null,
          speed: unit.Position?.Speed ?? null,
          batteryLevel: batteryLevel !== null && !isNaN(batteryLevel) ? batteryLevel : null,
          lastPositionAt
        }
      });

      updated++;

    } catch (error) {

      if ((error as { code?: string })?.code === "P2025") {
        skipped++;
      } else {
        throw error;
      }
    }
  }

  return {
    positionsChecked: positions.length,
    updated,
    skipped
  };
}
