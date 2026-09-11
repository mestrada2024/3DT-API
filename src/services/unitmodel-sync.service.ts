import { PrismaClient } from "@prisma/client";

import { Tracking3DService } from "../integrations/3dtracking/tracking.service";

export interface UnitModelSyncResult {
  total: number;
  created: number;
  updated: number;
  errors: number;
}

/**
 * Sincroniza la tabla local UnitModel derivando los valores
 * UnitModelUid/UnitModelName/TrackerTypeUid/TrackerTypeName presentes
 * en devices/tracker/list (no hay un catálogo dedicado de modelos en
 * 3Dtracking), consultada en vivo cada vez. Upsert por uid.
 */
export async function syncUnitModelsFromTrackers(
  prisma: PrismaClient,
  tracking3d: Tracking3DService
): Promise<UnitModelSyncResult> {

  const session = await tracking3d.authenticate();
  const trackers = await tracking3d.getTrackerList(session);

  const models = new Map<string, { name: string | null; trackerTypeUid: string | null; trackerTypeName: string | null }>();

  for (const tracker of trackers) {
    if (tracker?.UnitModelUid) {
      models.set(tracker.UnitModelUid, {
        name: tracker.UnitModelName || null,
        trackerTypeUid: tracker.TrackerTypeUid || null,
        trackerTypeName: tracker.TrackerTypeName || null
      });
    }
  }

  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const [uid, data] of models) {
    if (!data.name) {
      errors++;
      continue;
    }

    try {
      const result = await prisma.unitModel.upsert({
        where: { uid },
        create: {
          uid,
          name: data.name,
          trackerTypeUid: data.trackerTypeUid,
          trackerTypeName: data.trackerTypeName
        },
        update: {
          name: data.name,
          trackerTypeUid: data.trackerTypeUid,
          trackerTypeName: data.trackerTypeName
        }
      });

      if (result.createdAt.getTime() === result.updatedAt.getTime()) {
        created++;
      } else {
        updated++;
      }

    } catch (error) {
      console.error(`Error sincronizando unit model ${uid} (${data.name}):`, error);
      errors++;
    }
  }

  return {
    total: models.size,
    created,
    updated,
    errors
  };
}
