import Fastify from "fastify";

import helmet
  from "@fastify/helmet";

import cors
  from "@fastify/cors";

import rateLimit
  from "@fastify/rate-limit";

import prismaPlugin
  from "./plugins/prisma";

import authPlugin
  from "./plugins/auth";

import authenticatePlugin
  from "./plugins/authenticate";

import authRoutes
  from "./routes/auth";

import trackingRoutes
  from "./routes/tracking3d";

import unitsRoutes
  from "./routes/units";

import tracking3dPlugin
  from "./plugins/tracking3d";


const app =
  Fastify({
    logger: true
  });


async function start() {

  await app.register(
    helmet
  );

  await app.register(
    cors,
    {
      origin:
        process.env.CORS_ORIGIN === "*" ||
        !process.env.CORS_ORIGIN
          ? true
          : process.env.CORS_ORIGIN
              .split(",")
              .map((origin) => origin.trim())
    }
  );

  await app.register(
    rateLimit,
    {
      max: 100,
      timeWindow: "1 minute"
    }
  );

  await app.register(
    prismaPlugin
  );

  await app.register(
    authPlugin
  );

  await app.register(
    authenticatePlugin
  );

  await app.register(
    tracking3dPlugin
  );


  await app.register(
    authRoutes,
    {
      prefix: "/api/v1/auth"
    }
  );


  await app.register(
    trackingRoutes,
    {
      prefix: "/api/v1/tracking"
    }
  );


  await app.register(
    unitsRoutes,
    {
      prefix: "/api/v1/units"
    }
  );


  app.get(
    "/health",
    async () => {

      return {

        success: true,

        status: "healthy",

        service: "dms-api",

        timestamp:
          new Date().toISOString()

      };

    }
  );


  await app.listen({

    host:
      process.env.HOST ||
      "0.0.0.0",

    port:
      Number(
        process.env.PORT ||
        3010
      )

  });

}


start().catch(
  (err) => {

    app.log.error(err);

    process.exit(1);

  }
);