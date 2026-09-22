import { PrismaClient } from "@prisma/client";

import { Tracking3DService } from "../integrations/3dtracking/tracking.service";
import { getUnitTripsForDate } from "../services/unit-trips.service";

/**
 * Herramientas del agente de WhatsApp — cada una recibe companyUid ya
 * resuelto (ver resolveCompanyByPhone) y filtra TODO por esa empresa,
 * nunca por lo que el usuario escriba. El LLM elige qué tool llamar y
 * con qué argumentos, pero el alcance de datos lo impone este archivo,
 * no el modelo — mismo principio que el resto del sistema (ver
 * access-control.service.ts) y lo descrito en la sección 9 del
 * documento de diseño (Agente_IA_WhatsApp_DMS_3DTracking.md).
 *
 * "Rutas" (getRouteVehicles/getRouteLocation en el documento original)
 * no se implementan acá — no existe ese concepto en este sistema, las
 * unidades pertenecen a una empresa, no a una ruta.
 */

export interface ResolvedCompany {
  uid: string;
  name: string | null;
}

/**
 * Resuelve qué empresa corresponde a un número de WhatsApp entrante,
 * comparando contra Company.contactPhone (puede traer varios números
 * separados por coma — ver whatsapp-dispatch.service.ts). Devuelve
 * null si el número no está registrado como contacto de ninguna
 * empresa — el llamador debe negar la consulta en ese caso, sin
 * invocar al LLM (autorización ANTES del agente, no dentro).
 */
export async function resolveCompanyByPhone(
  prisma: PrismaClient,
  phone: string
): Promise<ResolvedCompany | null> {

  const normalizedPhone = phone.replace(/[^0-9]/g, "");

  const companies = await prisma.company.findMany({
    where: { contactPhone: { not: null } },
    select: { uid: true, name: true, contactPhone: true }
  });

  const match = companies.find((company) =>
    (company.contactPhone as string)
      .split(",")
      .map((p) => p.replace(/[^0-9]/g, ""))
      .includes(normalizedPhone)
  );

  return match ? { uid: match.uid, name: match.name } : null;
}

interface UnitLookupResult {
  status: "found" | "not_found" | "ambiguous";
  unit?: {
    externalId: string;
    name: string;
    plate: string | null;
    status: string;
    latitude: number | null;
    longitude: number | null;
    speed: number | null;
    batteryLevel: number | null;
    lastPositionAt: string | null;
    lastFuelLevel: number | null;
    lastFuelLevelAt: string | null;
  };
  candidates?: string[];
}

/**
 * Los usuarios escriben nombres aproximados ("UM321", "el camión de
 * Mauricio"), no el externalId exacto — se busca por nombre o placa
 * (contains, no sensible a mayúsculas) dentro de la empresa resuelta.
 * Si hay más de una coincidencia, se devuelven los nombres candidatos
 * para que el agente le pida al usuario que precise, en vez de
 * adivinar cuál — ver sección 15 del documento de diseño ("el agente
 * no debe inventar información").
 */
async function findUnit(
  prisma: PrismaClient,
  companyUid: string,
  vehicleName: string
): Promise<UnitLookupResult> {

  const units = await prisma.unit.findMany({
    where: {
      companyUid,
      OR: [
        { name: { contains: vehicleName } },
        { plate: { contains: vehicleName } }
      ]
    },
    select: {
      externalId: true,
      name: true,
      plate: true,
      status: true,
      latitude: true,
      longitude: true,
      speed: true,
      batteryLevel: true,
      lastPositionAt: true,
      lastFuelLevel: true,
      lastFuelLevelAt: true
    },
    take: 6
  });

  if (units.length === 0) {
    return { status: "not_found" };
  }

  if (units.length > 1) {
    return { status: "ambiguous", candidates: units.map((u) => u.name) };
  }

  const u = units[0];

  return {
    status: "found",
    unit: {
      externalId: u.externalId,
      name: u.name,
      plate: u.plate,
      status: u.status,
      latitude: u.latitude !== null ? Number(u.latitude) : null,
      longitude: u.longitude !== null ? Number(u.longitude) : null,
      speed: u.speed !== null ? Number(u.speed) : null,
      batteryLevel: u.batteryLevel !== null ? Number(u.batteryLevel) : null,
      lastPositionAt: u.lastPositionAt ? u.lastPositionAt.toISOString() : null,
      lastFuelLevel: u.lastFuelLevel !== null ? Number(u.lastFuelLevel) : null,
      lastFuelLevelAt: u.lastFuelLevelAt ? u.lastFuelLevelAt.toISOString() : null
    }
  };
}

export async function getVehicleLocation(
  prisma: PrismaClient,
  companyUid: string,
  vehicleName: string
) {
  return findUnit(prisma, companyUid, vehicleName);
}

export async function getVehicleStatus(
  prisma: PrismaClient,
  companyUid: string,
  vehicleName: string
) {
  return findUnit(prisma, companyUid, vehicleName);
}

export async function getFuelLevel(
  prisma: PrismaClient,
  companyUid: string,
  vehicleName: string
) {
  return findUnit(prisma, companyUid, vehicleName);
}

export async function getVehicleAlerts(
  prisma: PrismaClient,
  companyUid: string,
  vehicleName: string,
  from: string,
  to: string
) {

  const lookup = await findUnit(prisma, companyUid, vehicleName);

  if (lookup.status !== "found") {
    return lookup;
  }

  const events = await prisma.criticalAlertEvent.findMany({
    where: {
      companyUid,
      unitUid: lookup.unit!.externalId,
      occurredAt: { gte: new Date(from), lte: new Date(to) }
    },
    orderBy: { occurredAt: "desc" },
    take: 20,
    select: {
      alertTypeName: true,
      description: true,
      occurredAt: true
    }
  });

  return {
    status: "found" as const,
    unit: lookup.unit,
    alerts: events.map((e) => ({
      type: e.alertTypeName,
      description: e.description,
      occurredAt: e.occurredAt.toISOString()
    }))
  };
}

export async function getVehicleTrips(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  companyUid: string,
  vehicleName: string,
  date: string
) {

  const lookup = await findUnit(prisma, companyUid, vehicleName);

  if (lookup.status !== "found") {
    return lookup;
  }

  const trips = await getUnitTripsForDate(prisma, tracking3d, lookup.unit!.externalId, date);

  return {
    status: "found" as const,
    unit: lookup.unit,
    trips
  };
}
