import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import { Tracking3DService } from "../integrations/3dtracking/tracking.service";
import { syncUnitsFromTracking3D } from "../services/units-sync.service";

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
  const tracking3d = new Tracking3DService();

  const result = await syncUnitsFromTracking3D(prisma, tracking3d);

  console.log(
    `Sync finalizado: ${result.total} unidades en 3Dtracking, ${result.created} creadas, ${result.updated} actualizadas, ${result.skipped} omitidas, ${result.errors} con error`
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
