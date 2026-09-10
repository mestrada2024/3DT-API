import { PrismaClient } from "@prisma/client";

import { Tracking3DService } from "../integrations/3dtracking/tracking.service";

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
