import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",

  migrations: {
    path: "prisma/migrations"
  },

  datasource: {
    url: process.env.DATABASE_URL || "mysql://dmsapi:DmsBDD@db:3306/dmsapi"
  }
});
