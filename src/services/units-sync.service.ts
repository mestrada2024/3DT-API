import { PrismaClient, Unit, Tracker } from "@prisma/client";

import { Tracking3DService } from "../integrations/3dtracking/tracking.service";

export interface UnitsSyncResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}

export async function syncUnitsFromTracking3D(
  prisma: PrismaClient,
  tracking3d: Tracking3DService
): Promise<UnitsSyncResult> {

  const session = await tracking3d.authenticate();

  const units = await tracking3d.getUnitsList(session);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const unit of units) {
    try {
      const detail = await tracking3d.getUnitDetail(session, unit.Uid);

      if (!detail.IMEI || !/^\d+$/.test(detail.IMEI)) {
        skipped++;
        continue;
      }

      const plateAttribute = detail.AdditionalDetails.Attributes.find(
        (attribute) => attribute.Name === "Placa"
      );

      const result = await prisma.unit.upsert({
        where: {
          externalId: detail.Uid
        },
        create: {
          externalId: detail.Uid,
          trackingId: BigInt(detail.IMEI),
          imei: detail.IMEI,
          name: detail.Name,
          companyUid: detail.CompanyUid || null,
          companyName: detail.CompanyName || null,
          plate: plateAttribute?.Value || null,
          status: detail.Status || "unknown"
        },
        update: {
          trackingId: BigInt(detail.IMEI),
          imei: detail.IMEI,
          name: detail.Name,
          companyUid: detail.CompanyUid || null,
          companyName: detail.CompanyName || null,
          plate: plateAttribute?.Value || null,
          status: detail.Status || "unknown"
        }
      });

      if (result.createdAt.getTime() === result.updatedAt.getTime()) {
        created++;
      } else {
        updated++;
      }

    } catch (error) {
      console.error(`Error sincronizando unidad ${unit.Uid} (${unit.Name}):`, error);
      errors++;
    }
  }

  return {
    total: units.length,
    created,
    updated,
    skipped,
    errors
  };
}

export interface PlatePushResult {
  synced: boolean;
  message?: string;
}

export async function pushPlateToTracking3D(
  tracking3d: Tracking3DService,
  externalId: string,
  plate: string
): Promise<PlatePushResult> {

  const session = await tracking3d.authenticate();

  const detail = await tracking3d.getUnitDetail(session, externalId);

  const plateAttribute = detail.AdditionalDetails.Attributes.find(
    (attribute) => attribute.Name === "Placa"
  );

  if (!plateAttribute) {
    return {
      synced: false,
      message: "La unidad no tiene el atributo \"Placa\" configurado en 3Dtracking"
    };
  }

  await tracking3d.updateUnitAttribute(
    session,
    externalId,
    plateAttribute.AttributeId,
    plate
  );

  return {
    synced: true
  };
}

export class UnitValidationError extends Error {}

function extractImei(rawImei: string | null | undefined): string | null {
  return rawImei && /^\d+$/.test(rawImei) ? rawImei : null;
}

export interface UnitCreateInput {
  name: string;
  groupName?: string | null;
  unitFunction?: string | null;
  trackerUid?: string | null;
}

/**
 * Crea una unidad. A diferencia de SIMs/trackers, aquí se llama
 * primero a 3Dtracking (company/{Uid}/unitcreate) y solo si responde
 * bien se guarda localmente — Unit.externalId no admite null, y una
 * unidad sin contraparte real en 3Dtracking no tiene mucho sentido.
 * Si se pasa trackerUid, 3Dtracking la crea con ese tracker ya
 * asignado y aquí se refleja también en Tracker.unitUid.
 */
export async function createUnitAndReplicate(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  companyUid: string,
  input: UnitCreateInput
): Promise<Unit> {

  const session = await tracking3d.authenticate();

  const detail = await tracking3d.createUnit(session, companyUid, {
    Name: input.name,
    GroupName: input.groupName || undefined,
    UnitFunction: input.unitFunction || undefined,
    TrackerUid: input.trackerUid || undefined
  });

  const imei = extractImei(detail.IMEI);

  const plateAttribute = detail.AdditionalDetails?.Attributes?.find(
    (attribute) => attribute.Name === "Placa"
  );

  const unit = await prisma.unit.create({
    data: {
      externalId: detail.Uid,
      trackingId: imei ? BigInt(imei) : null,
      imei,
      name: detail.Name,
      companyUid: detail.CompanyUid || companyUid,
      companyName: detail.CompanyName || null,
      plate: plateAttribute?.Value || null,
      status: detail.Status || "unknown",
      trackerUid: input.trackerUid || null
    }
  });

  if (input.trackerUid) {
    await prisma.tracker.updateMany({
      where: { uid: input.trackerUid },
      data: { unitUid: detail.Uid }
    });
  }

  return unit;
}

/**
 * Elimina la unidad de verdad (no lógico) de la base local.
 * 3Dtracking no tiene ningún endpoint para eliminar unidades, así que
 * no hay réplica remota posible — el registro completo (`before`)
 * queda solo en el log de auditoría, como respaldo. Nota: borra en
 * cascada su historial de posiciones (tabla Position, FK con
 * onDelete: Cascade) — ese historial no se guarda en el log, solo la
 * unidad misma. Devuelve null si no existe.
 */
export async function deleteUnitLocal(
  prisma: PrismaClient,
  identifier: string
): Promise<{ before: Unit } | null> {

  const existing = await prisma.unit.findFirst({
    where: {
      OR: [
        { imei: identifier },
        { plate: identifier },
        { externalId: identifier },
        { name: identifier }
      ]
    }
  });

  if (!existing) {
    return null;
  }

  await prisma.unit.delete({
    where: { id: existing.id }
  });

  return { before: existing };
}

export interface UnitReplicationResult {
  synced: boolean;
  message?: string;
}

/**
 * Asigna un tracker a una unidad. El tracker se identifica por uid o
 * imei, y debe ya tener uid (haberse creado en 3Dtracking). Actualiza
 * local siempre primero (Unit.trackerUid/imei/trackingId tomados del
 * tracker, y de forma bidireccional Tracker.unitUid); intenta replicar
 * con units/assigntracker. Devuelve null si la unidad no existe.
 */
export async function assignTrackerToUnitAndReplicate(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  unitIdentifier: string,
  trackerIdentifier: string
): Promise<{ unit: Unit; tracker: Tracker; replication: UnitReplicationResult; before: Unit } | null> {

  const unitBefore = await prisma.unit.findFirst({
    where: {
      active: true,
      OR: [
        { imei: unitIdentifier },
        { plate: unitIdentifier },
        { externalId: unitIdentifier },
        { name: unitIdentifier }
      ]
    }
  });

  if (!unitBefore) {
    return null;
  }

  const tracker = await prisma.tracker.findFirst({
    where: {
      active: true,
      OR: [
        { uid: trackerIdentifier },
        { imei: trackerIdentifier }
      ]
    }
  });

  if (!tracker) {
    throw new UnitValidationError("Tracker no encontrado (o borrado lógicamente)");
  }

  if (!tracker.uid) {
    throw new UnitValidationError("El tracker no tiene uid (aún no se ha creado en 3Dtracking)");
  }

  const imei = extractImei(tracker.imei);

  const [unit, updatedTracker] = await Promise.all([
    prisma.unit.update({
      where: { id: unitBefore.id },
      data: {
        trackerUid: tracker.uid,
        imei,
        trackingId: imei ? BigInt(imei) : null
      }
    }),
    prisma.tracker.update({
      where: { id: tracker.id },
      data: { unitUid: unitBefore.externalId }
    })
  ]);

  const session = await tracking3d.authenticate();

  try {
    await tracking3d.assignTrackerToUnit(session, unit.externalId, tracker.uid);

    return { unit, tracker: updatedTracker, replication: { synced: true }, before: unitBefore };

  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";

    return { unit, tracker: updatedTracker, replication: { synced: false, message }, before: unitBefore };
  }
}

/**
 * Quita el tracker asignado a una unidad. Actualiza local siempre
 * primero (Unit.trackerUid/imei/trackingId a null y, de forma
 * bidireccional, el Tracker.unitUid correspondiente a null); intenta
 * replicar con units/unassigntracker. Devuelve null si la unidad no
 * existe. Lanza UnitValidationError si no tiene tracker asignado.
 */
export async function unassignTrackerFromUnitAndReplicate(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  unitIdentifier: string
): Promise<{ unit: Unit; tracker: Tracker | null; replication: UnitReplicationResult; before: Unit } | null> {

  const unitBefore = await prisma.unit.findFirst({
    where: {
      active: true,
      OR: [
        { imei: unitIdentifier },
        { plate: unitIdentifier },
        { externalId: unitIdentifier },
        { name: unitIdentifier }
      ]
    }
  });

  if (!unitBefore) {
    return null;
  }

  if (!unitBefore.trackerUid) {
    throw new UnitValidationError("La unidad no tiene un tracker asignado");
  }

  const previousTrackerUid = unitBefore.trackerUid;

  const [unit] = await Promise.all([
    prisma.unit.update({
      where: { id: unitBefore.id },
      data: { trackerUid: null, imei: null, trackingId: null }
    }),
    prisma.tracker.updateMany({
      where: { uid: previousTrackerUid },
      data: { unitUid: null }
    })
  ]);

  const tracker = await prisma.tracker.findFirst({
    where: { uid: previousTrackerUid }
  });

  const session = await tracking3d.authenticate();

  try {
    await tracking3d.unassignTrackerFromUnit(session, unit.externalId, previousTrackerUid);

    return { unit, tracker, replication: { synced: true }, before: unitBefore };

  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";

    return { unit, tracker, replication: { synced: false, message }, before: unitBefore };
  }
}
