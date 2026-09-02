import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import { Tracking3DClient } from "../integrations/3dtracking/tracking.client";

const adapter = new PrismaMariaDb({
  host: process.env.DB_HOST || "db",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "dmsapi",
  password: process.env.DB_PASSWORD || "DmsBDD",
  database: process.env.DB_NAME || "dmsapi",
  connectionLimit: 5
});

const prisma = new PrismaClient({
  adapter
});

async function main() {
  const client = new Tracking3DClient();
  const session = await client.authenticate();

  const units = await client.getUnitsList(session);

  console.log(`3Dtracking devolvió ${units.length} unidades`);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const unit of units) {
    try {
      const detail = await client.getUnitDetail(session, unit.Uid);

      if (!detail.IMEI) {
        console.warn(`Unidad ${detail.Uid} (${detail.Name}) sin IMEI, se omite`);
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

  console.log(
    `Sync finalizado: ${created} creadas, ${updated} actualizadas, ${skipped} omitidas, ${errors} con error`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
