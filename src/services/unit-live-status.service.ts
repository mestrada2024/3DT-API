import { PrismaClient } from "@prisma/client";

import { Tracking3DService } from "../integrations/3dtracking/tracking.service";
import {
  Tracking3DPositionListEntry,
  Tracking3DSensorReadingListEntry
} from "../integrations/3dtracking/tracking.types";

export interface UnitLiveStatusSyncResult {
  positionsPagesProcessed: number;
  positionsChecked: number;
  positionsUpdated: number;
  sensorPagesProcessed: number;
  sensorReadingsChecked: number;
  batteryUpdated: number;
  fuelReadingsChecked: number;
  fuelRefillsDetected: number;
}

const CURSOR_ID = 1;
const FUEL_SENSOR_NAME = "Nivel de Combustible";
/**
 * En 3Dtracking el umbral real de "cuánto subió el nivel para contar
 * como recarga" se configura por vehículo en su módulo de Alertas
 * (bloqueado para esta cuenta, ver docs) — confirmado con dos
 * ejemplos reales muy distintos: 50 galones para un camión grande,
 * 2 galones para una camioneta pequeña (Toyota Lite Ace). Sin acceso
 * a esos valores reales por unidad, se usa este default hasta que se
 * configure Unit.fuelRefillThresholdGallons caso por caso.
 */
const DEFAULT_FUEL_REFILL_THRESHOLD_GALLONS = 5;
/**
 * Solo se detectan/guardan recargas para DADA-DADA por ahora — mismo
 * alcance que critical-alert.service.ts (ENABLED_CLIENT_COMPANY_UIDS),
 * duplicado acá porque son servicios independientes; si el alcance
 * cambia, actualizar ambos.
 */
const FUEL_REFILL_ENABLED_COMPANY_UIDS = new Set(["2C809B"]);
/**
 * Bajo a propósito (vs. las 25 páginas de critical-alert.service.ts):
 * acá hay DOS streams por corrida (posiciones + sensores), y cada
 * página implica cientos/miles de UPDATE individuales a Unit —
 * confirmado en pruebas reales que con un cap más alto (5, luego 25)
 * una sola corrida podía tardar varios minutos solo en posiciones
 * (miles de updates secuenciales con reintentos), sin llegar nunca al
 * stream de batería dentro del intervalo de 60s. Con 1 página por
 * corrida, cada intervalo procesa una porción acotada de cada stream
 * y ambos avanzan de forma pareja hasta alcanzar el presente — toma
 * más ciclos en ponerse al día, pero nunca deja a uno de los dos sin
 * turno.
 */
const MAX_PAGES_PER_RUN = 1;
const BATTERY_SENSOR_TYPE = "Batería";
const BATTERY_MEASUREMENT_SIGN = "%";
const MAX_UPDATE_RETRIES = 3;

/**
 * Actualiza una unidad con reintentos ante el error transitorio de
 * MariaDB 1020 ("Record has changed since last read") — se observó en
 * pruebas reales que, con muchas actualizaciones secuenciales seguidas
 * sobre la misma tabla (una por unidad en cada página del stream), el
 * driver @prisma/adapter-mariadb puede devolver este error de forma
 * intermitente. Sin este reintento, UNA sola fila con este error
 * detenía el resto del lote completo (la excepción se propagaba fuera
 * del for-loop), dejando cientos de unidades sin actualizar — así se
 * vio en producción: "Telefono Mauricio" transmitiendo en 3Dtracking
 * pero sin datos en el dashboard, porque el primer error del lote
 * abortaba todo lo que venía después.
 *
 * P2025 (registro no encontrado — unidad aún no sincronizada por el
 * catálogo) se sigue tratando aparte, sin reintentar: no es
 * transitorio.
 */
type UpdateOutcome =
  | { outcome: "updated"; unitId: number }
  | { outcome: "not_found" };

async function updateUnitWithRetry(
  prisma: PrismaClient,
  externalId: string,
  data: Parameters<PrismaClient["unit"]["update"]>[0]["data"]
): Promise<UpdateOutcome> {

  for (let attempt = 1; attempt <= MAX_UPDATE_RETRIES; attempt++) {

    try {

      const updated = await prisma.unit.update({
        where: { externalId },
        data,
        select: { id: true }
      });

      return { outcome: "updated", unitId: updated.id };

    } catch (error) {

      const code = (error as { code?: string })?.code;

      if (code === "P2025") {
        return { outcome: "not_found" };
      }

      const isTransient =
        (error as { meta?: { driverAdapterError?: { cause?: { originalCode?: number } } } })
          ?.meta?.driverAdapterError?.cause?.originalCode === 1020;

      if (!isTransient || attempt === MAX_UPDATE_RETRIES) {
        throw error;
      }
    }
  }

  return { outcome: "not_found" };
}

/**
 * Actualiza, para cada unidad YA conocida localmente (creada vía sync
 * de catálogo o POST /units), su posición y batería más recientes.
 *
 * Usa dos streams cronológicos paginados por StartId (mismo mecanismo
 * que critical-alert.service.ts, con su propio cursor independiente en
 * UnitLiveStatusCursor):
 * - Data/PositionsList → latitude/longitude/speed/lastPositionAt
 *   ("hora de transmisión", de GPSTimeUtc/ServerTimeUTC).
 * - Data/SensorReadingsList → batteryLevel.
 *
 * Antes esto usaba Units/LatestPositionsList (que sí trae ambas cosas
 * en un solo llamado), pero ese endpoint quedó bloqueado por límite de
 * tasa (429) repetidamente en pruebas reales — dejando esta
 * sincronización sin actualizar nada, con datos "sin transmitir /sin
 * batería" en el dashboard aunque la unidad sí estuviera transmitiendo
 * en 3Dtracking. Ninguno de los dos streams usados acá mostró ese
 * problema.
 *
 * Para batería: solo se toman lecturas con SensorType "Batería" Y
 * MeasurementSign "%" — el mismo SensorType también se usa para
 * voltaje ("Batería Externa"/interna en voltios en algunos
 * dispositivos), que no es un porcentaje y mostraría números sin
 * sentido en el dashboard si se guardara tal cual.
 *
 * Unidades que no existen aún localmente se ignoran (no crea filas
 * nuevas — para eso está el sync de catálogo, POST /units/sync).
 */
export async function syncUnitLiveStatus(
  prisma: PrismaClient,
  tracking3d: Tracking3DService
): Promise<UnitLiveStatusSyncResult> {

  const cursor = await prisma.unitLiveStatusCursor.findUnique({
    where: { id: CURSOR_ID }
  });

  const result: UnitLiveStatusSyncResult = {
    positionsPagesProcessed: 0,
    positionsChecked: 0,
    positionsUpdated: 0,
    sensorPagesProcessed: 0,
    sensorReadingsChecked: 0,
    batteryUpdated: 0,
    fuelReadingsChecked: 0,
    fuelRefillsDetected: 0
  };

  // ---------- Posiciones (lastPositionAt, lat/lon, speed) ----------

  let positionsStartId = cursor?.positionsStartId?.toString();

  for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {

    const raw = await tracking3d.getPositionsList({
      startId: positionsStartId
    });

    const positions: Tracking3DPositionListEntry[] = raw?.Result?.Position || [];
    const newStartId: string | undefined =
      raw?.Result?.StartId !== undefined && raw?.Result?.StartId !== null
        ? String(raw.Result.StartId)
        : undefined;

    result.positionsPagesProcessed++;
    result.positionsChecked += positions.length;

    for (const position of positions) {

      const unit = position.Unit;

      if (!unit?.Uid) {
        continue;
      }

      const occurredAtRaw = position.GPSTimeUtc || position.ServerTimeUTC;

      const outcome = await updateUnitWithRetry(prisma, unit.Uid, {
        latitude: position.Latitude ?? null,
        longitude: position.Longitude ?? null,
        speed: position.Speed ?? null,
        lastPositionAt: occurredAtRaw ? new Date(occurredAtRaw) : null
      });

      if (outcome.outcome === "updated") {

        result.positionsUpdated++;

        /**
         * Historial local en Position — necesario para calcular
         * tiempo en viaje/ralentí/transmitiendo-apagado en el
         * dashboard (ver dashboard.service.ts) sin tener que volver a
         * consultar 3Dtracking por cada carga de pantalla. Antes esta
         * tabla existía en el esquema pero nada la llenaba.
         */
        if (occurredAtRaw) {

          try {

            await prisma.position.create({
              data: {
                unitId: outcome.unitId,
                latitude: position.Latitude,
                longitude: position.Longitude,
                speed: position.Speed ?? null,
                heading: position.Heading ?? null,
                ignition: position.Ignition ?? null,
                recordedAt: new Date(occurredAtRaw)
              }
            });

          } catch (error) {
            if ((error as { code?: string })?.code !== "P2002") {
              throw error;
            }
          }
        }
      }
    }

    if (newStartId) {

      await prisma.unitLiveStatusCursor.upsert({
        where: { id: CURSOR_ID },
        create: { id: CURSOR_ID, positionsStartId: BigInt(newStartId) },
        update: { positionsStartId: BigInt(newStartId) }
      });
    }

    if (!newStartId || newStartId === positionsStartId || positions.length === 0) {
      break;
    }

    positionsStartId = newStartId;
  }

  // ---------- Batería ----------

  let sensorsStartId = cursor?.sensorsStartId?.toString();

  for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {

    const raw = await tracking3d.getSensorReadingsList({
      startId: sensorsStartId
    });

    const readings: Tracking3DSensorReadingListEntry[] = raw?.Result?.SensorReadings || [];
    const newStartId: string | undefined =
      raw?.Result?.StartId !== undefined && raw?.Result?.StartId !== null
        ? String(raw.Result.StartId)
        : undefined;

    result.sensorPagesProcessed++;
    result.sensorReadingsChecked += readings.length;

    for (const reading of readings) {

      const fuelResult = await processFuelReading(prisma, reading);

      if (fuelResult.checked) {
        result.fuelReadingsChecked++;
      }

      if (fuelResult.refillDetected) {
        result.fuelRefillsDetected++;
      }

      if (
        !reading.UnitUid ||
        reading.SensorType !== BATTERY_SENSOR_TYPE ||
        reading.MeasurementSign !== BATTERY_MEASUREMENT_SIGN ||
        !reading.Value
      ) {
        continue;
      }

      const value = parseFloat(reading.Value);

      if (isNaN(value)) {
        continue;
      }

      const outcome = await updateUnitWithRetry(prisma, reading.UnitUid, {
        batteryLevel: value
      });

      if (outcome.outcome === "updated") {
        result.batteryUpdated++;
      }
    }

    if (newStartId) {

      await prisma.unitLiveStatusCursor.upsert({
        where: { id: CURSOR_ID },
        create: { id: CURSOR_ID, sensorsStartId: BigInt(newStartId) },
        update: { sensorsStartId: BigInt(newStartId) }
      });
    }

    if (!newStartId || newStartId === sensorsStartId || readings.length === 0) {
      break;
    }

    sensorsStartId = newStartId;
  }

  return result;
}

function toUtcDate(raw: string): Date {
  return new Date(raw.endsWith("Z") ? raw : `${raw}Z`);
}

/**
 * Detecta recargas de combustible comparando la lectura más reciente
 * de "Nivel de Combustible" contra la última guardada para esa unidad
 * (Unit.lastFuelLevel) — si sube al menos el umbral configurado
 * (Unit.fuelRefillThresholdGallons, o el default si no está
 * configurado), se guarda un CriticalAlertEvent tipo FUEL_REFILL.
 *
 * No depende del módulo de Alertas de 3Dtracking (bloqueado por
 * permisos, ErrorCode 50021) — se construye desde el stream crudo de
 * Data/SensorReadingsList, que sí es accesible.
 *
 * Se llama desde dentro del mismo loop de sensores que ya procesa
 * batería (ver syncUnitLiveStatus), para no duplicar el llamado a
 * getSensorReadingsList.
 */
async function processFuelReading(
  prisma: PrismaClient,
  reading: Tracking3DSensorReadingListEntry
): Promise<{ checked: boolean; refillDetected: boolean }> {

  if (
    !reading.UnitUid ||
    reading.Name !== FUEL_SENSOR_NAME ||
    !reading.Value
  ) {
    return { checked: false, refillDetected: false };
  }

  const newLevel = parseFloat(reading.Value);

  if (isNaN(newLevel)) {
    return { checked: false, refillDetected: false };
  }

  const unit = await prisma.unit.findUnique({
    where: { externalId: reading.UnitUid },
    select: {
      id: true,
      name: true,
      companyUid: true,
      lastFuelLevel: true,
      fuelRefillThresholdGallons: true
    }
  });

  if (!unit) {
    return { checked: false, refillDetected: false };
  }

  const readingAtRaw = reading.ReadingTimeUtc || reading.ServerTimeUtc;
  const readingAt = readingAtRaw ? toUtcDate(readingAtRaw) : new Date();

  const previousLevel = unit.lastFuelLevel !== null ? Number(unit.lastFuelLevel) : null;

  const threshold =
    unit.fuelRefillThresholdGallons !== null
      ? Number(unit.fuelRefillThresholdGallons)
      : DEFAULT_FUEL_REFILL_THRESHOLD_GALLONS;

  const delta = previousLevel !== null ? newLevel - previousLevel : null;
  const isRefill = delta !== null && delta >= threshold;

  await prisma.unit.update({
    where: { id: unit.id },
    data: { lastFuelLevel: newLevel, lastFuelLevelAt: readingAt }
  });

  if (!isRefill || !unit.companyUid || !FUEL_REFILL_ENABLED_COMPANY_UIDS.has(unit.companyUid)) {
    return { checked: true, refillDetected: false };
  }

  const company = await prisma.company.findUnique({
    where: { uid: unit.companyUid },
    select: { contactPhone: true }
  });

  try {

    await prisma.criticalAlertEvent.create({
      data: {
        alertTypeCode: "FUEL_REFILL",
        alertTypeName: "Recarga de combustible telemetría",
        unitUid: reading.UnitUid,
        unitName: unit.name || null,
        companyUid: unit.companyUid,
        contactPhone: company?.contactPhone || null,
        description: `Recarga detectada: +${delta!.toFixed(1)} gal (de ${previousLevel!.toFixed(1)} a ${newLevel.toFixed(1)} gal)`,
        occurredAt: readingAt
      }
    });

  } catch (error) {
    if ((error as { code?: string })?.code !== "P2002") {
      throw error;
    }
  }

  return { checked: true, refillDetected: true };
}
