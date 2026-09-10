import { PrismaClient, Sim } from "@prisma/client";

import { Tracking3DService } from "../integrations/3dtracking/tracking.service";
import { Tracking3DSession, Tracking3DSimCard } from "../integrations/3dtracking/tracking.types";

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

function findActiveSimWhere(identifier: string) {
  return {
    active: true,
    OR: [
      { iccid: identifier },
      { externalId: identifier }
    ]
  };
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

  const localDuplicate = await prisma.sim.findFirst({
    where: {
      ...(excludeSimId !== undefined && { id: { not: excludeSimId } }),
      OR: [
        { iccid },
        ...(phoneNumber ? [{ phoneNumber }] : [])
      ]
    }
  });

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

interface LocalSimCheckResult {
  conflict: Sim | null;
  reviveTarget: Sim | null;
}

/**
 * Busca conflictos locales de iccid/phoneNumber para una creación. Si
 * el único match es por iccid y ese registro está borrado
 * (syncStatus "deleted"), no es un conflicto real: se devuelve como
 * `reviveTarget`, para reactivar (UPDATE) esa fila en vez de bloquear
 * o insertar una nueva.
 */
async function checkLocalSimForCreate(
  prisma: PrismaClient,
  iccid: string,
  phoneNumber: string | null
): Promise<LocalSimCheckResult> {

  const matches = await prisma.sim.findMany({
    where: {
      OR: [
        { iccid },
        ...(phoneNumber ? [{ phoneNumber }] : [])
      ]
    }
  });

  const iccidMatch = matches.find((sim) => sim.iccid === iccid) ?? null;

  const phoneMatch = phoneNumber
    ? matches.find((sim) => sim.phoneNumber === phoneNumber) ?? null
    : null;

  if (iccidMatch && iccidMatch.syncStatus !== "deleted") {
    return { conflict: iccidMatch, reviveTarget: null };
  }

  if (phoneMatch && phoneMatch.id !== iccidMatch?.id) {
    return { conflict: phoneMatch, reviveTarget: null };
  }

  if (iccidMatch) {
    return { conflict: null, reviveTarget: iccidMatch };
  }

  return { conflict: null, reviveTarget: null };
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
 * el iccid y el phoneNumber no estén ya en uso. Si ya existe local con
 * ese iccid pero borrado (syncStatus "deleted"), en vez de bloquear
 * reactiva (UPDATE) esa misma fila. Lanza SimValidationError /
 * SimDuplicateError si la validación falla, o si no se pudo ni
 * siquiera consultar 3Dtracking para validar.
 */
export async function createSimAndReplicate(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  input: SimCreateInput
): Promise<{ sim: Sim; replication: SimReplicationResult; revived: boolean }> {

  const iccid = input.iccid?.trim();

  if (!iccid) {
    throw new SimValidationError("ICCID requerido");
  }

  const phoneNumber = input.phoneNumber?.trim() || null;

  const { conflict, reviveTarget } = await checkLocalSimForCreate(prisma, iccid, phoneNumber);

  if (conflict) {
    const field: "iccid" | "phoneNumber" = conflict.iccid === iccid ? "iccid" : "phoneNumber";

    throw new SimDuplicateError(
      field,
      "local",
      `Ya existe un SIM local con ese ${field}`
    );
  }

  const session = await tracking3d.authenticate();
  const tracking3dSims = await tracking3d.getSimList(session);

  const remoteDuplicate = findRemoteSimDuplicate(
    tracking3dSims,
    iccid,
    phoneNumber,
    reviveTarget?.externalId
  );

  if (remoteDuplicate) {
    const field: "iccid" | "phoneNumber" = remoteDuplicate.ICCID === iccid ? "iccid" : "phoneNumber";

    throw new SimDuplicateError(
      field,
      "3dtracking",
      `Ya existe un SIM en 3Dtracking con ese ${field}`
    );
  }

  const sim = reviveTarget
    ? await prisma.sim.update({
        where: { id: reviveTarget.id },
        data: {
          phoneNumber,
          pin: input.pin?.trim() || null,
          puk: input.puk?.trim() || null,
          trackerUid: input.trackerUid?.trim() || null,
          active: true,
          syncStatus: "pending",
          syncError: null,
          externalId: null,
          syncedAt: null
        }
      })
    : await prisma.sim.create({
        data: {
          iccid,
          phoneNumber,
          pin: input.pin?.trim() || null,
          puk: input.puk?.trim() || null,
          trackerUid: input.trackerUid?.trim() || null
        }
      });

  const result = await replicateSimToTracking3D(prisma, tracking3d, session, sim);

  return { ...result, revived: Boolean(reviveTarget) };
}

export interface SimsImportItemResult {
  iccid: string;
  created: boolean;
  revived: boolean;
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

      const { conflict, reviveTarget } = await checkLocalSimForCreate(prisma, iccid, phoneNumber);

      if (conflict) {
        const field: "iccid" | "phoneNumber" = conflict.iccid === iccid ? "iccid" : "phoneNumber";

        throw new SimDuplicateError(
          field,
          "local",
          `Ya existe un SIM local con ese ${field}`
        );
      }

      const remoteDuplicate = findRemoteSimDuplicate(
        tracking3dSims,
        iccid,
        phoneNumber,
        reviveTarget?.externalId
      );

      if (remoteDuplicate) {
        const field: "iccid" | "phoneNumber" = remoteDuplicate.ICCID === iccid ? "iccid" : "phoneNumber";

        throw new SimDuplicateError(
          field,
          "3dtracking",
          `Ya existe un SIM en 3Dtracking con ese ${field}`
        );
      }

      const sim = reviveTarget
        ? await prisma.sim.update({
            where: { id: reviveTarget.id },
            data: {
              phoneNumber,
              pin: input.pin?.trim() || null,
              puk: input.puk?.trim() || null,
              trackerUid: input.trackerUid?.trim() || null,
              active: true,
              syncStatus: "pending",
              syncError: null,
              externalId: null,
              syncedAt: null
            }
          })
        : await prisma.sim.create({
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
        revived: Boolean(reviveTarget),
        synced: replication.synced,
        message: replication.message
      });

    } catch (error) {
      errors++;

      const message = error instanceof Error ? error.message : "Error desconocido";

      items.push({
        iccid,
        created: false,
        revived: false,
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
 * Busca un SIM activo por iccid o externalId, valida (local + consulta
 * en vivo a 3Dtracking, excluyendo al propio SIM) que el phoneNumber
 * nuevo no esté en uso, actualiza los campos provistos en la base
 * local y replica el cambio en 3Dtracking. Devuelve null si no existe
 * (o está borrado lógicamente).
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

  return replicateSimUpdateToTracking3D(prisma, tracking3d, session, sim);
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
