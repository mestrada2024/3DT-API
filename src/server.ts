import Fastify from "fastify";

(BigInt.prototype as unknown as { toJSON: () => string }).toJSON =
  function (this: bigint) {
    return this.toString();
  };

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

import trackerRoutes
  from "./routes/trackers";

import trackerTypeRoutes
  from "./routes/trackertypes";

import unitModelRoutes
  from "./routes/unitmodels";

import companyRoutes
  from "./routes/companies";

import criticalAlertRoutes
  from "./routes/critical-alerts";

import messagingRoutes
  from "./routes/messaging";

import usersRoutes
  from "./routes/users";

import dashboardRoutes
  from "./routes/dashboard";

import webhooks3dtRoutes
  from "./routes/webhooks-3dt";

import reportsRoutes
  from "./routes/reports";

import chatTicketsRoutes
  from "./routes/chat-tickets";

import chatFaqRoutes
  from "./routes/chat-faq";

import chatQueuesRoutes
  from "./routes/chat-queues";

import liveShareRoutes
  from "./routes/live-share";

import notificationsRoutes
  from "./routes/notifications";

import queryEngineRoutes
  from "./routes/query-engine";

import chatTicketReleaseSchedulerPlugin
  from "./plugins/chat-ticket-release-scheduler";

import tracking3dPlugin
  from "./plugins/tracking3d";

import criticalAlertSchedulerPlugin
  from "./plugins/critical-alert-scheduler";

import dmsMessagingPlugin
  from "./plugins/dms-messaging";

import whatsappDispatchSchedulerPlugin
  from "./plugins/whatsapp-dispatch-scheduler";

import unitLiveStatusSchedulerPlugin
  from "./plugins/unit-live-status-scheduler";

import alerts3dScanSchedulerPlugin
  from "./plugins/alerts3d-scan-scheduler";


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
              .map((origin) => origin.trim()),
      /**
       * El default de @fastify/cors (v11) es "GET,HEAD,POST" — alcanzaba
       * mientras frontend y API no estaban en dominios distintos de
       * verdad (probado por IP/puerto, o con curl, que no aplica CORS).
       * Apenas quedaron en dominios separados (dada-fleet/dada-api,
       * 2026-10-09) cualquier PATCH/DELETE/PUT cross-origin empezó a
       * fallar en el preflight con un error de red genérico en el
       * navegador (no un error de la API) — ver el toggle de WhatsApp
       * en el módulo Alertas.
       */
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]
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
    criticalAlertSchedulerPlugin
  );

  await app.register(
    dmsMessagingPlugin
  );

  await app.register(
    unitLiveStatusSchedulerPlugin
  );

  await app.register(
    whatsappDispatchSchedulerPlugin
  );

  await app.register(
    alerts3dScanSchedulerPlugin
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

  await app.register(
    trackerRoutes,
    {
      prefix: "/api/v1/tracking"
    }
  );


  await app.register(
    trackerTypeRoutes,
    {
      prefix: "/api/v1/tracking"
    }
  );


  await app.register(
    unitModelRoutes,
    {
      prefix: "/api/v1/tracking"
    }
  );


  await app.register(
    companyRoutes,
    {
      prefix: "/api/v1/tracking"
    }
  );


  await app.register(
    criticalAlertRoutes,
    {
      prefix: "/api/v1/tracking"
    }
  );


  await app.register(
    messagingRoutes,
    {
      prefix: "/api/v1"
    }
  );


  await app.register(
    usersRoutes,
    {
      prefix: "/api/v1/admin"
    }
  );


  await app.register(
    dashboardRoutes,
    {
      prefix: "/api/v1"
    }
  );


  await app.register(
    webhooks3dtRoutes,
    {
      prefix: "/api/v1"
    }
  );


  await app.register(
    chatTicketsRoutes,
    {
      prefix: "/api/v1"
    }
  );


  await app.register(
    chatFaqRoutes,
    {
      prefix: "/api/v1"
    }
  );


  await app.register(
    chatQueuesRoutes,
    {
      prefix: "/api/v1"
    }
  );


  await app.register(
    liveShareRoutes,
    {
      prefix: "/api/v1"
    }
  );


  await app.register(
    notificationsRoutes,
    {
      prefix: "/api/v1"
    }
  );


  await app.register(
    queryEngineRoutes,
    {
      prefix: "/api/v1"
    }
  );


  await app.register(
    chatTicketReleaseSchedulerPlugin
  );


  await app.register(
    reportsRoutes,
    {
      prefix: "/api/v1/tracking"
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
