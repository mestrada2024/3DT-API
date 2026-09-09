import { PrismaClient, Sim } from "@prisma/client";

import { Tracking3DService } from "../integrations/3dtracking/tracking.service";

export interface SimCreateInput {
  iccid: string;
  phoneNumber?: string | null;
  pin?: string | null;
  puk?: string | null;
  trackerUid?: string | null;
}

export interface SimReplicationResult {
  synced: boolean;
  message?: string;
}

/**
 * Intenta crear el SIM en 3Dtracking y refleja el resultado en el
 * registro local (externalId + syncStatus). Nunca lanza: un fallo al
 * replicar no debe deshacer la creación local, que ya quedó guardada.
 */
async function replicateSimToTracking3D(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  sim: Sim
): Promise<{ sim: Sim; replication: SimReplicationResult }> {

  try {
    const session = await tracking3d.authenticate();

    const created = await tracking3d.createSim(session, {
      ICCID: sim.iccid,
      PhoneNumber: sim.phoneNumber || undefined,
      PIN: sim.pin || undefined,
      PUK: sim.puk || undefined
    });

    const updated = await prisma.sim.update({
      where: { id: sim.id },
      data: {
        externalId: created.Uid,
        syncStatus: "synced",
        syncError: null,
        syncedAt: new Date()
      }
    });

    return { sim: updated, replication: { synced: true } };

  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";

    const updated = await prisma.sim.update({
      where: { id: sim.id },
      data: {
        syncStatus: "error",
        syncError: message
      }
    });

    return { sim: updated, replication: { synced: false, message } };
  }
}

/**
 * Crea un SIM en la base local y, a continuación, lo replica en
 * 3Dtracking. Lanza únicamente si falla el guardado local (p.ej.
 * ICCID duplicado); un fallo de 3Dtracking se reporta en el resultado
 * sin deshacer la creación local.
 */
export async function createSimAndReplicate(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  input: SimCreateInput
): Promise<{ sim: Sim; replication: SimReplicationResult }> {

  const iccid = input.iccid?.trim();

  if (!iccid) {
    throw new Error("ICCID requerido");
  }

  const sim = await prisma.sim.create({
    data: {
      iccid,
      phoneNumber: input.phoneNumber?.trim() || null,
      pin: input.pin?.trim() || null,
      puk: input.puk?.trim() || null,
      trackerUid: input.trackerUid?.trim() || null
    }
  });

  return replicateSimToTracking3D(prisma, tracking3d, sim);
}

export interface SimsImportItemResult {
  iccid: string;
  created: boolean;
  synced: boolean;
  message?: string;
}

export interface SimsImportResult {
  total: number;
  created: number;
  errors: number;
  items: SimsImportItemResult[];
}

/**
 * Carga masiva: cada registro se crea localmente y se replica en
 * 3Dtracking de forma independiente (mismo flujo que la creación
 * individual), para que un fallo puntual no detenga el resto del lote.
 */
export async function importSimsAndReplicate(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  inputs: SimCreateInput[]
): Promise<SimsImportResult> {

  let created = 0;
  let errors = 0;
  const items: SimsImportItemResult[] = [];

  for (const input of inputs) {
    try {
      const { replication } = await createSimAndReplicate(prisma, tracking3d, input);

      created++;

      items.push({
        iccid: input.iccid?.trim() || "",
        created: true,
        synced: replication.synced,
        message: replication.message
      });

    } catch (error) {
      errors++;

      const message = error instanceof Error ? error.message : "Error desconocido";

      items.push({
        iccid: input.iccid?.trim() || "",
        created: false,
        synced: false,
        message
      });
    }
  }

  return {
    total: inputs.length,
    created,
    errors,
    items
  };
}

function findActiveSimWhere(identifier: string) {
  return {
    active: true,
    OR: [
      { iccid: identifier },
      { externalId: identifier }
    ]
  };
}

export interface SimUpdateInput {
  phoneNumber?: string | null;
  pin?: string | null;
  puk?: string | null;
  trackerUid?: string | null;
}

/**
 * Intenta actualizar el SIM en 3Dtracking (requiere que ya tenga
 * externalId, es decir que se haya creado allá) y refleja el
 * resultado en el registro local. Nunca lanza.
 */
async function replicateSimUpdateToTracking3D(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  sim: Sim
): Promise<{ sim: Sim; replication: SimReplicationResult }> {

  if (!sim.externalId) {
    return {
      sim,
      replication: {
        synced: false,
        message: "El SIM no tiene externalId (aún no se ha creado en 3Dtracking)"
      }
    };
  }

  try {
    const session = await tracking3d.authenticate();

    await tracking3d.updateSim(session, sim.externalId, {
      ICCID: sim.iccid,
      PhoneNumber: sim.phoneNumber || undefined,
      PIN: sim.pin || undefined,
      PUK: sim.puk || undefined
    });

    const updated = await prisma.sim.update({
      where: { id: sim.id },
      data: {
        syncStatus: "synced",
        syncError: null,
        syncedAt: new Date()
      }
    });

    return { sim: updated, replication: { synced: true } };

  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";

    const updated = await prisma.sim.update({
      where: { id: sim.id },
      data: {
        syncStatus: "error",
        syncError: message
      }
    });

    return { sim: updated, replication: { synced: false, message } };
  }
}

/**
 * Busca un SIM activo por iccid o externalId, actualiza los campos
 * provistos en la base local y, a continuación, replica el cambio en
 * 3Dtracking. Devuelve null si no existe (o está borrado lógicamente).
 */
export async function updateSimAndReplicate(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  identifier: string,
  input: SimUpdateInput
): Promise<{ sim: Sim; replication: SimReplicationResult } | null> {

  const existing = await prisma.sim.findFirst({
    where: findActiveSimWhere(identifier)
  });

  if (!existing) {
    return null;
  }

  const sim = await prisma.sim.update({
    where: { id: existing.id },
    data: {
      ...(input.phoneNumber !== undefined && { phoneNumber: input.phoneNumber?.trim() || null }),
      ...(input.pin !== undefined && { pin: input.pin?.trim() || null }),
      ...(input.puk !== undefined && { puk: input.puk?.trim() || null }),
      ...(input.trackerUid !== undefined && { trackerUid: input.trackerUid?.trim() || null })
    }
  });

  return replicateSimUpdateToTracking3D(prisma, tracking3d, sim);
}

/**
 * Intenta eliminar el SIM en 3Dtracking (requiere externalId) y
 * refleja el resultado en el registro local. Nunca lanza.
 */
async function replicateSimDeleteToTracking3D(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  sim: Sim
): Promise<{ sim: Sim; replication: SimReplicationResult }> {

  if (!sim.externalId) {
    return {
      sim,
      replication: {
        synced: false,
        message: "El SIM no tiene externalId (nunca se creó en 3Dtracking)"
      }
    };
  }

  try {
    const session = await tracking3d.authenticate();

    await tracking3d.deleteSim(session, sim.externalId);

    const updated = await prisma.sim.update({
      where: { id: sim.id },
      data: {
        syncStatus: "deleted",
        syncError: null,
        syncedAt: new Date()
      }
    });

    return { sim: updated, replication: { synced: true } };

  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";

    const updated = await prisma.sim.update({
      where: { id: sim.id },
      data: {
        syncStatus: "error",
        syncError: message
      }
    });

    return { sim: updated, replication: { synced: false, message } };
  }
}

/**
 * Borrado lógico: marca el SIM como inactivo (active: false) en la
 * base local y, a continuación, lo elimina en 3Dtracking (si ya tenía
 * externalId). Devuelve null si no existe (o ya estaba borrado).
 */
export async function deleteSimAndReplicate(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  identifier: string
): Promise<{ sim: Sim; replication: SimReplicationResult } | null> {

  const existing = await prisma.sim.findFirst({
    where: findActiveSimWhere(identifier)
  });

  if (!existing) {
    return null;
  }

  const sim = await prisma.sim.update({
    where: { id: existing.id },
    data: { active: false }
  });

  return replicateSimDeleteToTracking3D(prisma, tracking3d, sim);
}
