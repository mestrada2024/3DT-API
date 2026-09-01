import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

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
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    throw new Error(
      "ADMIN_USERNAME and ADMIN_PASSWORD are required"
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: {
      username
    },
    update: {
      passwordHash,
      role: "admin",
      active: true
    },
    create: {
      username,
      passwordHash,
      role: "admin",
      active: true
    }
  });

  console.log(`Admin user created/updated: ${user.username}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
