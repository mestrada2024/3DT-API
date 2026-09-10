import cron from "node-cron";
import { PrismaClient } from "@prisma/client";
import { FastifyBaseLogger } from "fastify";

import { Tracking3DService } from "../integrations/3dtracking/tracking.service";
import { syncTrackersFromTracking3D } from "../services/tracker-sync.service";

const SCHEDULER_TIMEZONE = process.env.SCHEDULER_TIMEZONE || "America/El_Salvador";

/**
 * Registra los jobs recurrentes de la app. Para agregar uno nuevo:
 * cron.schedule(expresión, tarea, { timezone: SCHEDULER_TIMEZONE, name }).
 */
export function registerScheduledJobs(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  logger: FastifyBaseLogger
): void {

  // Domingo a las 00:00 (hora de SCHEDULER_TIMEZONE)
  cron.schedule(
    "0 0 * * 0",
    async () => {

      logger.info("Iniciando sincronización programada de trackers");

      try {
        const result = await syncTrackersFromTracking3D(prisma, tracking3d);

        logger.info(
          { result },
          "Sincronización programada de trackers completada"
        );

      } catch (error) {

        logger.error(
          error,
          "Falló la sincronización programada de trackers"
        );
      }
    },
    {
      timezone: SCHEDULER_TIMEZONE,
      name: "tracker-weekly-sync"
    }
  );

  logger.info(
    `Job "tracker-weekly-sync" programado: domingos 00:00 (${SCHEDULER_TIMEZONE})`
  );
}
