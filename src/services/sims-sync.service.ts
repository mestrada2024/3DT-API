import { PrismaClient, Sim, Tracker } from "@prisma/client";

import { Tracking3DService } from "../integrations/3dtracking/tracking.service";
import { Tracking3DSession, Tracking3DSimCard } from "../integrations/3dtracking/tracking.types";
import { deallocateSimFromTracker } from "./tracker-sync.service";

export interface SimCreateInput {
  iccid: string;
  phoneNumber?: string | null;
  pin?: string | null;
  puk?: string | null;
  trackerUid?: string | null;
}

export interface SimUpdateInput {
  phoneNumber?: string | null;
  pin?: string | null;
  puk?: string | null;
  trackerUid?: string | null;
}

export interface SimReplicationResult {
  synced: boolean;
  message?: string;
}

export class SimValidationError extends Error {}

export class SimDuplicateError extends Error {
  constructor(
    public readonly field: "iccid" | "phoneNumber",
    public readonly source: "local" | "3dtracking",
    message: string
  ) {
    super(message);
  }
}

function findSimWhere(identifier: string) {
  return {
    OR: [
      { iccid: identifier },
      { externalId: identifier }
    ]
  };
}

async function findLocalSimDuplicate(
  prisma: PrismaClient,
  iccid: string,
  phoneNumber: string | null,
  excludeSimId?: number
): Promise<Sim | null> {

  return prisma.sim.findFirst({
    where: {
      ...(excludeSimId !== undefined && { id: { not: excludeSimId } }),
      OR: [
        { iccid },
        ...(phoneNumber ? [{ phoneNumber }] : [])
      ]
    }
  });
}

function findRemoteSimDuplicate(
  tracking3dSims: Tracking3DSimCard[],
  iccid: string,
  phoneNumber: string | null,
  excludeExternalId?: string | null
): Tracking3DSimCard | undefined {

  return tracking3dSims.find((sim) =>
    sim &&
    sim.Uid !== excludeExternalId &&
    (sim.ICCID === iccid || (phoneNumber !== null && sim.PhoneNumber === phoneNumber))
  );
}

/**
 * Valida que iccid/phoneNumber no estén ya en uso, tanto en la base
 * local como en 3Dtracking (contra la lista ya obtenida). Se usa antes
 * de crear o actualizar un SIM. `excludeSimId`/`excludeExternalId` se
 * usan en actualizaciones, para no comparar el registro contra sí
 * mismo.
 */
async function assertSimNotDuplicated(
  prisma: PrismaClient,
  iccid: string,
  phoneNumber: string | null,
  tracking3dSims: Tracking3DSimCard[],
  excludeSimId?: number,
  excludeExternalId?: string | null
): Promise<void> {

  const localDuplicate = await findLocalSimDuplicate(prisma, iccid, phoneNumber, excludeSimId);

  if (localDuplicate) {
    const field: "iccid" | "phoneNumber" = localDuplicate.iccid === iccid ? "iccid" : "phoneNumber";

    throw new SimDuplicateError(
      field,
      "local",
      `Ya existe un SIM local con ese ${field}`
    );
  }

  const remoteDuplicate = findRemoteSimDuplicate(tracking3dSims, iccid, phoneNumber, excludeExternalId);

  if (remoteDuplicate) {
    const field: "iccid" | "phoneNumber" = remoteDuplicate.ICCID === iccid ? "iccid" : "phoneNumber";

    throw new SimDuplicateError(
      field,
      "3dtracking",
      `Ya existe un SIM en 3Dtracking con ese ${field}`
    );
  }
}

/**
 * Intenta crear el SIM en 3Dtracking y refleja el resultado en el
 * registro local (externalId + syncStatus). Nunca lanza: un fallo al
 * replicar no debe deshacer la creación local, que ya quedó guardada.
 */
async function replicateSimToTracking3D(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  session: Tracking3DSession,
  sim: Sim
): Promise<{ sim: Sim; replication: SimReplicationResult }> {

  try {
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
 * Crea un SIM en la base local y lo replica en 3Dtracking. Antes de
 * escribir nada, valida (local + consulta en vivo a 3Dtracking) que
 * el iccid y el phoneNumber no estén ya en uso. Lanza
 * SimValidationError / SimDuplicateError si la validación falla, o si
 * no se pudo ni siquiera consultar 3Dtracking para validar.
 */
export async function createSimAndReplicate(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  input: SimCreateInput
): Promise<{ sim: Sim; replication: SimReplicationResult }> {

  const iccid = input.iccid?.trim();

  if (!iccid) {
    throw new SimValidationError("ICCID requerido");
  }

  const phoneNumber = input.phoneNumber?.trim() || null;

  const session = await tracking3d.authenticate();
  const tracking3dSims = await tracking3d.getSimList(session);

  await assertSimNotDuplicated(prisma, iccid, phoneNumber, tracking3dSims);

  const sim = await prisma.sim.create({
    data: {
      iccid,
      phoneNumber,
      pin: input.pin?.trim() || null,
      puk: input.puk?.trim() || null,
      trackerUid: input.trackerUid?.trim() || null
    }
  });

  return replicateSimToTracking3D(prisma, tracking3d, session, sim);
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
 * Carga masiva: autentica y consulta la lista de 3Dtracking una sola
 * vez para todo el lote (no por registro), y la va extendiendo con
 * cada SIM creado exitosamente para detectar también duplicados
 * dentro del propio lote. Cada registro se crea localmente y se
 * replica en 3Dtracking de forma independiente: un fallo puntual no
 * detiene el resto.
 */
export async function importSimsAndReplicate(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  inputs: SimCreateInput[]
): Promise<SimsImportResult> {

  const session = await tracking3d.authenticate();
  const tracking3dSims = await tracking3d.getSimList(session);

  let created = 0;
  let errors = 0;
  const items: SimsImportItemResult[] = [];

  for (const input of inputs) {
    const iccid = input.iccid?.trim() || "";

    try {
      if (!iccid) {
        throw new SimValidationError("ICCID requerido");
      }

      const phoneNumber = input.phoneNumber?.trim() || null;

      await assertSimNotDuplicated(prisma, iccid, phoneNumber, tracking3dSims);

      const sim = await prisma.sim.create({
        data: {
          iccid,
          phoneNumber,
          pin: input.pin?.trim() || null,
          puk: input.puk?.trim() || null,
          trackerUid: input.trackerUid?.trim() || null
        }
      });

      const { sim: updatedSim, replication } =
        await replicateSimToTracking3D(prisma, tracking3d, session, sim);

      tracking3dSims.push({
        Uid: updatedSim.externalId || "",
        ICCID: iccid,
        PhoneNumber: phoneNumber || "",
        PIN: "",
        PUK: "",
        TrackerUid: "",
        CreatedDateTimeUtc: ""
      });

      created++;

      items.push({
        iccid,
        created: true,
        synced: replication.synced,
        message: replication.message
      });

    } catch (error) {
      errors++;

      const message = error instanceof Error ? error.message : "Error desconocido";

      items.push({
        iccid,
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

/**
 * Intenta actualizar el SIM en 3Dtracking (requiere que ya tenga
 * externalId, es decir que se haya creado allá) y refleja el
 * resultado en el registro local. Nunca lanza.
 */
async function replicateSimUpdateToTracking3D(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  session: Tracking3DSession,
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
 * Busca un SIM por iccid o externalId, valida (local + consulta en
 * vivo a 3Dtracking, excluyendo al propio SIM) que el phoneNumber
 * nuevo no esté en uso, actualiza los campos provistos en la base
 * local y replica el cambio en 3Dtracking. Devuelve null si no existe.
 */
export async function updateSimAndReplicate(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  identifier: string,
  input: SimUpdateInput
): Promise<{ sim: Sim; replication: SimReplicationResult; before: Sim } | null> {

  const existing = await prisma.sim.findFirst({
    where: findSimWhere(identifier)
  });

  if (!existing) {
    return null;
  }

  const phoneNumber = input.phoneNumber !== undefined
    ? (input.phoneNumber?.trim() || null)
    : existing.phoneNumber;

  const session = await tracking3d.authenticate();
  const tracking3dSims = await tracking3d.getSimList(session);

  await assertSimNotDuplicated(
    prisma,
    existing.iccid,
    phoneNumber,
    tracking3dSims,
    existing.id,
    existing.externalId
  );

  const sim = await prisma.sim.update({
    where: { id: existing.id },
    data: {
      ...(input.phoneNumber !== undefined && { phoneNumber }),
      ...(input.pin !== undefined && { pin: input.pin?.trim() || null }),
      ...(input.puk !== undefined && { puk: input.puk?.trim() || null }),
      ...(input.trackerUid !== undefined && { trackerUid: input.trackerUid?.trim() || null })
    }
  });

  const result = await replicateSimUpdateToTracking3D(prisma, tracking3d, session, sim);

  return { ...result, before: existing };
}

export interface SimDeleteResult {
  before: Sim;
  replication: SimReplicationResult;
  unassignedFromTracker?: Tracker;
}

/**
 * Elimina el SIM de verdad (no lógico) de la base local. Antes
 * intenta eliminarlo también en 3Dtracking, si ya tenía externalId —
 * 3Dtracking no permite eliminar un SIM mientras está asignado a un
 * tracker, así que si el SIM tiene trackerUid se desasigna primero
 * (best-effort: si esa desasignación falla, igual se intenta el
 * delete, para no bloquear el borrado por eso); si se desasignó, el
 * tracker resultante (ya sin ese SIM) se devuelve en
 * `unassignedFromTracker`. El resultado de la replicación no se
 * persiste en ninguna tabla (la fila ya no existe): queda solo en el
 * log de auditoría, junto con el registro completo (`before`) como
 * respaldo. Devuelve null si no existe.
 */
export async function deleteSimAndReplicate(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  identifier: string
): Promise<SimDeleteResult | null> {

  const existing = await prisma.sim.findFirst({
    where: findSimWhere(identifier)
  });

  if (!existing) {
    return null;
  }

  let replication: SimReplicationResult;
  let unassignedFromTracker: Tracker | undefined;

  if (existing.externalId) {
    try {
      if (existing.trackerUid) {
        try {
          const deallocateResult = await deallocateSimFromTracker(prisma, tracking3d, existing.trackerUid);

          if (deallocateResult) {
            unassignedFromTracker = deallocateResult.tracker;
          }
        } catch {
          // best-effort: si falla, igual se intenta eliminar el SIM abajo
        }
      }

      const session = await tracking3d.authenticate();

      await tracking3d.deleteSim(session, existing.externalId);

      replication = { synced: true };

    } catch (error) {
      replication = {
        synced: false,
        message: error instanceof Error ? error.message : "Error desconocido"
      };
    }
  } else {
    replication = {
      synced: false,
      message: "El SIM no tiene externalId (nunca se creó en 3Dtracking)"
    };
  }

  await prisma.sim.delete({
    where: { id: existing.id }
  });

  return { before: existing, replication, unassignedFromTracker };
}

export interface SimsSyncResult {
  total: number;
  created: number;
  updated: number;
  errors: number;
}

/**
 * Sincroniza la tabla local Sim contra Devices/Sim/List (el inventario
 * real de SIMs de la cuenta). Upsert por iccid. 3Dtracking nunca
 * devuelve PIN/PUK en el listado (vienen siempre vacíos), así que el
 * sync no los toca en un update — solo los fija en un create, donde
 * no hay nada que perder. Un mismo iccid duplicado en 3Dtracking (dato
 * real observado) se registra como error para ese item sin detener el
 * resto del sync.
 */
export async function syncSimsFromTracking3D(
  prisma: PrismaClient,
  tracking3d: Tracking3DService
): Promise<SimsSyncResult> {

  const session = await tracking3d.authenticate();
  const tracking3dSims = await tracking3d.getSimList(session);

  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const sim of tracking3dSims) {
    if (!sim?.ICCID) {
      errors++;
      continue;
    }

    try {
      const phoneNumber = sim.PhoneNumber?.trim() || null;
      const trackerUid = sim.TrackerUid?.trim() || null;
      const pin = sim.PIN?.trim() || null;
      const puk = sim.PUK?.trim() || null;

      const result = await prisma.sim.upsert({
        where: { iccid: sim.ICCID },
        create: {
          iccid: sim.ICCID,
          phoneNumber,
          trackerUid,
          pin,
          puk,
          externalId: sim.Uid,
          syncStatus: "synced",
          syncedAt: new Date()
        },
        update: {
          phoneNumber,
          trackerUid,
          externalId: sim.Uid,
          syncStatus: "synced",
          syncError: null,
          syncedAt: new Date()
        }
      });

      if (result.createdAt.getTime() === result.updatedAt.getTime()) {
        created++;
      } else {
        updated++;
      }

    } catch (error) {
      console.error(`Error sincronizando SIM ${sim.ICCID} (${sim.Uid}):`, error);
      errors++;
    }
  }

  return {
    total: tracking3dSims.length,
    created,
    updated,
    errors
  };
}
