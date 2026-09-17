import fp from "fastify-plugin";

import { syncUnitLiveStatus } from "../services/unit-live-status.service";

const DEFAULT_INTERVAL_SECONDS = 60;
const MIN_INTERVAL_SECONDS = 15;

/**
 * Corre syncUnitLiveStatus() en un intervalo recurrente para que el
 * dashboard (GET /api/v1/units) siempre tenga batería, posición y
 * hora de transmisión razonablemente al día, sin que el frontend
 * dispare una llamada a 3Dtracking en cada carga de pantalla — ver
 * unit-live-status.service.ts para por qué no se puede simplemente
 * llamar a 3Dtracking directo desde la ruta (límite de tasa ya visto
 * en este mismo endpoint, Units/LatestPositionsList).
 *
 * Variables de entorno:
 * - UNIT_LIVE_STATUS_SYNC_ENABLED=false   desactiva este escaneo
 * - UNIT_LIVE_STATUS_SYNC_INTERVAL_SECONDS=60   mínimo forzado: 15
 */
export default fp(async (app) => {

  const enabled = process.env.UNIT_LIVE_STATUS_SYNC_ENABLED !== "false";

  if (!enabled) {

    app.log.info(
      "Unit live status: sincronización automática desactivada (UNIT_LIVE_STATUS_SYNC_ENABLED=false)"
    );

    return;
  }

  const intervalSeconds = Math.max(
    parseInt(
      process.env.UNIT_LIVE_STATUS_SYNC_INTERVAL_SECONDS ||
        String(DEFAULT_INTERVAL_SECONDS),
      10
    ) || DEFAULT_INTERVAL_SECONDS,
    MIN_INTERVAL_SECONDS
  );

  let syncing = false;

  const runSync = async () => {

    if (syncing) {
      return;
    }

    syncing = true;

    try {

      const result = await syncUnitLiveStatus(app.prisma, app.tracking3d);

      app.log.debug(
        { result },
        "Unit live status: sincronización completada"
      );

    } catch (error) {

      app.log.error(
        error,
        "Unit live status: falló la sincronización automática"
      );

    } finally {

      syncing = false;
    }
  };

  const timer = setInterval(runSync, intervalSeconds * 1000);

  app.addHook("onClose", async () => {
    clearInterval(timer);
  });

  app.log.info(
    `Unit live status: sincronización automática activa cada ${intervalSeconds}s`
  );

  runSync();
});
