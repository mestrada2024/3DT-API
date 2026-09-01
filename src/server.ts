import Fastify from "fastify";

import prismaPlugin from "./plugins/prisma";
import authPlugin from "./plugins/auth";
import authenticatePlugin from "./plugins/authenticate";

import authRoutes from "./routes/auth";
import trackingRoutes from "./routes/tracking3d";
import unitsRoutes from "./routes/units";

import tracking3dPlugin from "./plugins/tracking3d";

const app = Fastify({
  logger: true
});

async function start() {
  try {
    // =========================================================
    // PLUGINS
    // =========================================================

    // Prisma
    await app.register(prismaPlugin);

    // JWT
    await app.register(authPlugin);

    // Authentication middleware
    await app.register(authenticatePlugin);

    // 3DTracking
    await app.register(tracking3dPlugin);


    // =========================================================
    // ROUTES
    // =========================================================

    // Tracking
    await app.register(trackingRoutes, {
      prefix: "/api/v1/tracking"
    });

    // Authentication
    await app.register(authRoutes, {
      prefix: "/api/v1/auth"
    });

    // Units
    await app.register(unitsRoutes, {
      prefix: "/api/v1/units"
    });


    // =========================================================
    // HEALTH CHECK
    // =========================================================

    app.get("/health", async () => {
      return {
        success: true,
        status: "healthy",
        service: "dms-api",
        timestamp: new Date().toISOString()
      };
    });


    // =========================================================
    // START SERVER
    // =========================================================

    await app.listen({
      host: "0.0.0.0",
      port: Number(process.env.PORT || 3010)
    });

    app.log.info(
      `DMS API running on port ${process.env.PORT || 3010}`
    );

  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
