import { PrismaClient, Tracker } from "@prisma/client";

import { Tracking3DService } from "../integrations/3dtracking/tracking.service";
import { Tracking3DTracker, Tracking3DSession } from "../integrations/3dtracking/tracking.types";

export interface TrackerSyncResult {
  total: number;
  created: number;
  updated: number;
  errors: number;
}

/**
 * Sincroniza la tabla local Tracker contra devices/tracker/list (el
 * inventario real de trackers físicos de la cuenta). Upsert por uid.
 */
export async function syncTrackersFromTracking3D(
  prisma: PrismaClient,
  tracking3d: Tracking3DService
): Promise<TrackerSyncResult> {

  const session = await tracking3d.authenticate();
  const trackers = await tracking3d.getTrackerList(session);

  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const tracker of trackers) {
    if (!tracker?.Uid) {
      errors++;
      continue;
    }

    try {
      const createdDateTimeUtc = tracker.CreatedDateTimeUtc
        ? new Date(tracker.CreatedDateTimeUtc)
        : null;

      const result = await prisma.tracker.upsert({
        where: { uid: tracker.Uid },
        create: {
          uid: tracker.Uid,
          name: tracker.Name || null,
          imei: tracker.IMEI || null,
          trackerTypeUid: tracker.TrackerTypeUid || null,
          trackerTypeName: tracker.TrackerTypeName || null,
          unitModelUid: tracker.UnitModelUid || null,
          unitModelName: tracker.UnitModelName || null,
          simUid: tracker.SimUid || null,
          activationCode: tracker.ActivationCode || null,
          createdDateTimeUtc
        },
        update: {
          name: tracker.Name || null,
          imei: tracker.IMEI || null,
          trackerTypeUid: tracker.TrackerTypeUid || null,
          trackerTypeName: tracker.TrackerTypeName || null,
          unitModelUid: tracker.UnitModelUid || null,
          unitModelName: tracker.UnitModelName || null,
          simUid: tracker.SimUid || null,
          activationCode: tracker.ActivationCode || null,
          createdDateTimeUtc
        }
      });

      if (result.createdAt.getTime() === result.updatedAt.getTime()) {
        created++;
      } else {
        updated++;
      }

    } catch (error) {
      console.error(`Error sincronizando tracker ${tracker.Uid} (${tracker.Name}):`, error);
      errors++;
    }
  }

  return {
    total: trackers.length,
    created,
    updated,
    errors
  };
}

export interface TrackerCreateInput {
  name?: string | null;
  imei: string;
  trackerTypeUid?: string | null;
  unitModelUid?: string | null;
  simUid?: string | null;
}

export interface TrackerReplicationResult {
  synced: boolean;
  message?: string;
}

export class TrackerValidationError extends Error {}

export class TrackerDuplicateError extends Error {
  constructor(
    public readonly source: "local" | "3dtracking",
    message: string
  ) {
    super(message);
  }
}

/**
 * Intenta crear el tracker en 3Dtracking y refleja el resultado en el
 * registro local (uid + datos que devuelve 3Dtracking + syncStatus).
 * Nunca lanza: un fallo al replicar no debe deshacer la creación
 * local, que ya quedó guardada.
 */
async function replicateTrackerToTracking3D(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  session: Tracking3DSession,
  tracker: Tracker
): Promise<{ tracker: Tracker; replication: TrackerReplicationResult }> {

  try {
    const created = await tracking3d.createTracker(session, {
      Name: tracker.name || undefined,
      IMEI: tracker.imei || "",
      TrackerTypeUid: tracker.trackerTypeUid || undefined,
      UnitModelUid: tracker.unitModelUid || undefined,
      SimUid: tracker.simUid || undefined
    });

    const updated = await prisma.tracker.update({
      where: { id: tracker.id },
      data: {
        uid: created.Uid,
        trackerTypeName: created.TrackerTypeName || null,
        unitModelName: created.UnitModelName || null,
        activationCode: created.ActivationCode || null,
        createdDateTimeUtc: created.CreatedDateTimeUtc ? new Date(created.CreatedDateTimeUtc) : null,
        syncStatus: "synced",
        syncError: null,
        syncedAt: new Date()
      }
    });

    return { tracker: updated, replication: { synced: true } };

  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";

    const updated = await prisma.tracker.update({
      where: { id: tracker.id },
      data: {
        syncStatus: "error",
        syncError: message
      }
    });

    return { tracker: updated, replication: { synced: false, message } };
  }
}

/**
 * Crea un tracker en la base local y lo replica en 3Dtracking. Antes
 * de escribir nada, valida (local + consulta en vivo a 3Dtracking)
 * que el IMEI no esté ya en uso. Lanza TrackerValidationError /
 * TrackerDuplicateError si la validación falla, o si no se pudo ni
 * siquiera consultar 3Dtracking para validar.
 */
export async function createTrackerAndReplicate(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  input: TrackerCreateInput
): Promise<{ tracker: Tracker; replication: TrackerReplicationResult }> {

  const imei = input.imei?.trim();

  if (!imei) {
    throw new TrackerValidationError("IMEI requerido");
  }

  const localDuplicate = await prisma.tracker.findFirst({
    where: { imei }
  });

  if (localDuplicate) {
    throw new TrackerDuplicateError(
      "local",
      "Ya existe un tracker local con ese IMEI"
    );
  }

  const session = await tracking3d.authenticate();
  const tracking3dTrackers = await tracking3d.getTrackerList(session);

  const remoteDuplicate = tracking3dTrackers.find(
    (item: Tracking3DTracker) => item && item.IMEI === imei
  );

  if (remoteDuplicate) {
    throw new TrackerDuplicateError(
      "3dtracking",
      "Ya existe un tracker en 3Dtracking con ese IMEI"
    );
  }

  const tracker = await prisma.tracker.create({
    data: {
      imei,
      name: input.name?.trim() || null,
      trackerTypeUid: input.trackerTypeUid?.trim() || null,
      unitModelUid: input.unitModelUid?.trim() || null,
      simUid: input.simUid?.trim() || null,
      syncStatus: "pending"
    }
  });

  return replicateTrackerToTracking3D(prisma, tracking3d, session, tracker);
}

export interface TrackerUpdateInput {
  name?: string | null;
  imei?: string | null;
  simUid?: string | null;
}

function findActiveTrackerWhere(identifier: string) {
  return {
    active: true,
    OR: [
      { uid: identifier },
      { imei: identifier }
    ]
  };
}

/**
 * Intenta actualizar el tracker en 3Dtracking (requiere que ya tenga
 * uid, es decir que se haya creado allá) y refleja el resultado en el
 * registro local. Nunca lanza.
 */
async function replicateTrackerUpdateToTracking3D(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  session: Tracking3DSession,
  tracker: Tracker
): Promise<{ tracker: Tracker; replication: TrackerReplicationResult }> {

  if (!tracker.uid) {
    return {
      tracker,
      replication: {
        synced: false,
        message: "El tracker no tiene uid (aún no se ha creado en 3Dtracking)"
      }
    };
  }

  try {
    await tracking3d.updateTracker(session, tracker.uid, {
      Name: tracker.name || undefined,
      IMEI: tracker.imei || undefined,
      SimUid: tracker.simUid || undefined
    });

    const updated = await prisma.tracker.update({
      where: { id: tracker.id },
      data: {
        syncStatus: "synced",
        syncError: null,
        syncedAt: new Date()
      }
    });

    return { tracker: updated, replication: { synced: true } };

  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";

    const updated = await prisma.tracker.update({
      where: { id: tracker.id },
      data: {
        syncStatus: "error",
        syncError: message
      }
    });

    return { tracker: updated, replication: { synced: false, message } };
  }
}

/**
 * Busca un tracker por uid o imei, valida (local + consulta en vivo a
 * 3Dtracking, excluyendo al propio tracker) que el IMEI nuevo no esté
 * en uso, actualiza los campos provistos en la base local (name, imei,
 * simUid — no trackerTypeUid/unitModelUid: devices/tracker/{Uid}/update
 * no los admite) y replica el cambio en 3Dtracking. Devuelve null si
 * no existe.
 */
export async function updateTrackerAndReplicate(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  identifier: string,
  input: TrackerUpdateInput
): Promise<{ tracker: Tracker; replication: TrackerReplicationResult; before: Tracker } | null> {

  const existing = await prisma.tracker.findFirst({
    where: findActiveTrackerWhere(identifier)
  });

  if (!existing) {
    return null;
  }

  const imei = input.imei !== undefined
    ? (input.imei?.trim() || null)
    : existing.imei;

  if (input.imei !== undefined && imei !== existing.imei) {

    if (!imei) {
      throw new TrackerValidationError("IMEI no puede quedar vacío");
    }

    const localDuplicate = await prisma.tracker.findFirst({
      where: {
        imei,
        id: { not: existing.id }
      }
    });

    if (localDuplicate) {
      throw new TrackerDuplicateError(
        "local",
        "Ya existe un tracker local con ese IMEI"
      );
    }
  }

  const session = await tracking3d.authenticate();

  if (input.imei !== undefined && imei !== existing.imei) {

    const tracking3dTrackers = await tracking3d.getTrackerList(session);

    const remoteDuplicate = tracking3dTrackers.find(
      (item: Tracking3DTracker) => item && item.Uid !== existing.uid && item.IMEI === imei
    );

    if (remoteDuplicate) {
      throw new TrackerDuplicateError(
        "3dtracking",
        "Ya existe un tracker en 3Dtracking con ese IMEI"
      );
    }
  }

  const tracker = await prisma.tracker.update({
    where: { id: existing.id },
    data: {
      ...(input.name !== undefined && { name: input.name?.trim() || null }),
      ...(input.imei !== undefined && { imei }),
      ...(input.simUid !== undefined && { simUid: input.simUid?.trim() || null })
    }
  });

  const result = await replicateTrackerUpdateToTracking3D(prisma, tracking3d, session, tracker);

  return { ...result, before: existing };
}

/**
 * Intenta eliminar el tracker en 3Dtracking (requiere uid) y refleja
 * el resultado en el registro local. Nunca lanza.
 */
async function replicateTrackerDeleteToTracking3D(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  tracker: Tracker
): Promise<{ tracker: Tracker; replication: TrackerReplicationResult }> {

  if (!tracker.uid) {
    return {
      tracker,
      replication: {
        synced: false,
        message: "El tracker no tiene uid (nunca se creó en 3Dtracking)"
      }
    };
  }

  try {
    const session = await tracking3d.authenticate();

    await tracking3d.deleteTracker(session, tracker.uid);

    const updated = await prisma.tracker.update({
      where: { id: tracker.id },
      data: {
        syncStatus: "deleted",
        syncError: null,
        syncedAt: new Date()
      }
    });

    return { tracker: updated, replication: { synced: true } };

  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";

    const updated = await prisma.tracker.update({
      where: { id: tracker.id },
      data: {
        syncStatus: "error",
        syncError: message
      }
    });

    return { tracker: updated, replication: { synced: false, message } };
  }
}

/**
 * Borrado lógico: marca el tracker como inactivo (active: false) en
 * la base local y, a continuación, lo elimina en 3Dtracking (si ya
 * tenía uid). Devuelve null si no existe (o ya estaba borrado).
 */
export async function deleteTrackerAndReplicate(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  identifier: string
): Promise<{ tracker: Tracker; replication: TrackerReplicationResult; before: Tracker } | null> {

  const existing = await prisma.tracker.findFirst({
    where: findActiveTrackerWhere(identifier)
  });

  if (!existing) {
    return null;
  }

  const tracker = await prisma.tracker.update({
    where: { id: existing.id },
    data: { active: false }
  });

  const result = await replicateTrackerDeleteToTracking3D(prisma, tracking3d, tracker);

  return { ...result, before: existing };
}
