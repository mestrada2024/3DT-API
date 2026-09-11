import { PrismaClient } from "@prisma/client";

import { Tracking3DService } from "../integrations/3dtracking/tracking.service";

export interface TrackerTypeSyncResult {
  total: number;
  created: number;
  updated: number;
  errors: number;
}

/**
 * Sincroniza la tabla local TrackerType. El endpoint dedicado de
 * 3Dtracking (devices/trackertype/list) devuelve un catálogo vacío en
 * esta cuenta, así que los tipos se derivan de los valores
 * TrackerTypeUid/TrackerTypeName presentes en devices/tracker/list
 * (la lista real de trackers), consultada en vivo cada vez.
 */
export async function syncTrackerTypesFromTrackers(
  prisma: PrismaClient,
  tracking3d: Tracking3DService
): Promise<TrackerTypeSyncResult> {

  const session = await tracking3d.authenticate();
  const trackers = await tracking3d.getTrackerList(session);

  const types = new Map<string, string | null>();

  for (const tracker of trackers) {
    if (tracker?.TrackerTypeUid) {
      types.set(tracker.TrackerTypeUid, tracker.TrackerTypeName || null);
    }
  }

  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const [uid, name] of types) {
    try {
      const result = await prisma.trackerType.upsert({
        where: { uid },
        create: { uid, name },
        update: { name }
      });

      if (result.createdAt.getTime() === result.updatedAt.getTime()) {
        created++;
      } else {
        updated++;
      }

    } catch (error) {
      console.error(`Error sincronizando tracker type ${uid} (${name}):`, error);
      errors++;
    }
  }

  return {
    total: types.size,
    created,
    updated,
    errors
  };
}
