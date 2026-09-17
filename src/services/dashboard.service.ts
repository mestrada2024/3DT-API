import { PrismaClient } from "@prisma/client";

export interface DashboardCounts {
  totalUnits: number;
  active: number;
  inactive: number;
  transmitting: number;
  notTransmittingOver1Day: number;
  totalCompanies: number;
}

export interface TopCompanyItem {
  companyUid: string;
  companyName: string | null;
  count: number;
}

export interface TopUnitItem {
  unitId: number;
  externalId: string;
  name: string;
  companyName: string | null;
  value: number;
}

export interface DateRange {
  from: Date;
  to: Date;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MOVING_SPEED_THRESHOLD = 2;
const MAX_GAP_MINUTES = 30;
const TOP_LIMIT = 5;

function companyWhere(allowedCompanyUids: string[] | null) {
  return allowedCompanyUids !== null ? { companyUid: { in: allowedCompanyUids } } : {};
}

/**
 * "inactiv"/"suspend" antes que "activ" a propósito: "Inactivo"
 * contiene "activ" como substring — mismo bug ya corregido en
 * Dashboard.tsx (frontend), clasificado igual acá para consistencia.
 * Confirmado con datos reales: 185 Activo, 137 Inactivo, 33 Suspendido.
 */
function isActiveStatus(status: string): boolean {
  const normalized = status.toLowerCase();

  if (normalized.includes("inactiv") || normalized.includes("suspend")) {
    return false;
  }

  return normalized.includes("activ");
}

export async function getDashboardCounts(
  prisma: PrismaClient,
  allowedCompanyUids: string[] | null
): Promise<DashboardCounts> {

  const where = companyWhere(allowedCompanyUids);
  const oneDayAgo = new Date(Date.now() - ONE_DAY_MS);

  const [statusGroups, transmitting, notTransmittingOver1Day, totalUnits, totalCompanies] =
    await Promise.all([
      prisma.unit.groupBy({
        by: ["status"],
        where,
        _count: { _all: true }
      }),

      prisma.unit.count({
        where: { ...where, lastPositionAt: { gte: oneDayAgo } }
      }),

      prisma.unit.count({
        where: {
          ...where,
          OR: [{ lastPositionAt: null }, { lastPositionAt: { lt: oneDayAgo } }]
        }
      }),

      prisma.unit.count({ where }),

      allowedCompanyUids !== null
        ? Promise.resolve(allowedCompanyUids.length)
        : prisma.company.count()
    ]);

  let active = 0;
  let inactive = 0;

  for (const group of statusGroups) {
    if (isActiveStatus(group.status)) {
      active += group._count._all;
    } else {
      inactive += group._count._all;
    }
  }

  return {
    totalUnits,
    active,
    inactive,
    transmitting,
    notTransmittingOver1Day,
    totalCompanies
  };
}

export async function getTopCompaniesByTransmitting(
  prisma: PrismaClient,
  allowedCompanyUids: string[] | null
): Promise<TopCompanyItem[]> {

  const oneDayAgo = new Date(Date.now() - ONE_DAY_MS);

  /**
   * companyUid: allowedCompanyUids ya implica "not null" (una lista de
   * UIDs reales) — antes esto se armaba con ...where seguido de
   * companyUid: { not: null } en el mismo objeto, y la segunda clave
   * pisaba la primera (bug real: ignoraba el filtro de empresa por
   * completo, mostrando el top-5 de TODA la cuenta a cualquier
   * usuario, sin importar su rol o empresas asignadas).
   */
  const groups = await prisma.unit.groupBy({
    by: ["companyUid"],
    where: {
      lastPositionAt: { gte: oneDayAgo },
      companyUid: allowedCompanyUids !== null
        ? { in: allowedCompanyUids }
        : { not: null }
    },
    _count: true,
    orderBy: { _count: { companyUid: "desc" } },
    take: TOP_LIMIT
  });

  const companyUids = groups
    .map((g) => g.companyUid)
    .filter((uid): uid is string => Boolean(uid));

  const companies = companyUids.length
    ? await prisma.company.findMany({
        where: { uid: { in: companyUids } },
        select: { uid: true, name: true }
      })
    : [];

  const nameByUid = new Map(companies.map((c) => [c.uid, c.name]));

  return groups
    .filter((g): g is typeof g & { companyUid: string } => Boolean(g.companyUid))
    .map((g) => ({
      companyUid: g.companyUid,
      companyName: nameByUid.get(g.companyUid) || g.companyUid,
      count: g._count
    }));
}

export async function getTopUnitsByAlarms(
  prisma: PrismaClient,
  allowedCompanyUids: string[] | null,
  range: DateRange
): Promise<TopUnitItem[]> {

  const where: {
    occurredAt: { gte: Date; lte: Date };
    companyUid?: { in: string[] };
  } = {
    occurredAt: { gte: range.from, lte: range.to }
  };

  if (allowedCompanyUids !== null) {
    where.companyUid = { in: allowedCompanyUids };
  }

  const groups = await prisma.criticalAlertEvent.groupBy({
    by: ["unitUid", "unitName"],
    where,
    _count: true,
    orderBy: { _count: { unitUid: "desc" } },
    take: TOP_LIMIT
  });

  return groups.map((g) => ({
    unitId: 0,
    externalId: g.unitUid,
    name: g.unitName || g.unitUid,
    companyName: null,
    value: g._count
  }));
}

/**
 * Tiempo en viaje / ralentí / transmitiendo-apagado — calculado desde
 * el historial local en Position (ver unit-live-status.service.ts;
 * antes esta tabla no se llenaba). Se suma el tiempo transcurrido
 * entre muestras consecutivas de cada unidad: en movimiento (velocidad
 * > 2 km/h) cuenta como "en viaje", detenida con el motor encendido
 * cuenta como "ralentí". Brechas de más de 30 min entre muestras
 * (unidad sin transmitir un rato) no se cuentan, para no inflar los
 * totales con silencios largos.
 */
export async function getTopUnitsByTripAndIdleTime(
  prisma: PrismaClient,
  allowedCompanyUids: string[] | null,
  range: DateRange
): Promise<{
  tripTime: TopUnitItem[];
  idleTime: TopUnitItem[];
  transmittingOff: TopUnitItem[];
}> {

  const where = companyWhere(allowedCompanyUids);

  const units = await prisma.unit.findMany({
    where,
    select: { id: true, externalId: true, name: true, companyName: true }
  });

  const unitMap = new Map(units.map((u) => [u.id, u]));
  const unitIds = units.map((u) => u.id);

  if (unitIds.length === 0) {
    return { tripTime: [], idleTime: [], transmittingOff: [] };
  }

  const positions = await prisma.position.findMany({
    where: {
      unitId: { in: unitIds },
      recordedAt: { gte: range.from, lte: range.to }
    },
    select: { unitId: true, recordedAt: true, speed: true, ignition: true },
    orderBy: [{ unitId: "asc" }, { recordedAt: "asc" }]
  });

  const tripMinutes = new Map<number, number>();
  const idleMinutes = new Map<number, number>();
  const offCount = new Map<number, number>();

  let prevUnitId: number | null = null;
  let prevTime: number | null = null;

  for (const position of positions) {

    const speed = position.speed !== null ? Number(position.speed) : 0;
    const ignitionOff = position.ignition === "off";

    if (ignitionOff) {
      offCount.set(position.unitId, (offCount.get(position.unitId) || 0) + 1);
    }

    if (prevUnitId === position.unitId && prevTime !== null) {

      const deltaMinutes = Math.min(
        (position.recordedAt.getTime() - prevTime) / 60000,
        MAX_GAP_MINUTES
      );

      if (deltaMinutes > 0) {

        if (speed > MOVING_SPEED_THRESHOLD) {
          tripMinutes.set(position.unitId, (tripMinutes.get(position.unitId) || 0) + deltaMinutes);
        } else if (!ignitionOff) {
          idleMinutes.set(position.unitId, (idleMinutes.get(position.unitId) || 0) + deltaMinutes);
        }
      }
    }

    prevUnitId = position.unitId;
    prevTime = position.recordedAt.getTime();
  }

  function topFrom(map: Map<number, number>): TopUnitItem[] {
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_LIMIT)
      .map(([unitId, value]) => {
        const unit = unitMap.get(unitId)!;
        return {
          unitId,
          externalId: unit.externalId,
          name: unit.name,
          companyName: unit.companyName,
          value: Math.round(value)
        };
      });
  }

  return {
    tripTime: topFrom(tripMinutes),
    idleTime: topFrom(idleMinutes),
    transmittingOff: topFrom(offCount)
  };
}
