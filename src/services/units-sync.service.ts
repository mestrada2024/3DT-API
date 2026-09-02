import { PrismaClient } from "@prisma/client";

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
          plate: plateAttribute?.Value || null,
          status: detail.Status || "unknown"
        },
        update: {
          trackingId: BigInt(detail.IMEI),
          imei: detail.IMEI,
          name: detail.Name,
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
