import fp from "fastify-plugin";
import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export default fp(async (app) => {
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

  await prisma.$connect();

  app.decorate("prisma", prisma);

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });
});
