import fp from "fastify-plugin";

import { scanForCriticalAlerts } from "../services/critical-alert.service";

const DEFAULT_INTERVAL_SECONDS = 30;
const MIN_INTERVAL_SECONDS = 5;

/**
 * Ejecuta scanForCriticalAlerts() en un intervalo recurrente para que
 * los eventos de alerta crítica se guarden casi en tiempo real, sin
 * depender de que alguien llame a POST /critical-alerts/scan a mano.
 *
 * Configurable por variables de entorno:
 * - CRITICAL_ALERTS_SCAN_ENABLED=false   desactiva el escaneo automático
 * - CRITICAL_ALERTS_SCAN_INTERVAL_SECONDS=30   cada cuánto escanear (mínimo 5)
 */
export default fp(async (app) => {

  const enabled = process.env.CRITICAL_ALERTS_SCAN_ENABLED !== "false";

  if (!enabled) {

    app.log.info(
      "Critical alerts: escaneo automático desactivado (CRITICAL_ALERTS_SCAN_ENABLED=false)"
    );

    return;
  }

  const intervalSeconds = Math.max(
    parseInt(
      process.env.CRITICAL_ALERTS_SCAN_INTERVAL_SECONDS ||
        String(DEFAULT_INTERVAL_SECONDS),
      10
    ) || DEFAULT_INTERVAL_SECONDS,
    MIN_INTERVAL_SECONDS
  );

  let scanning = false;

  const runScan = async () => {

    if (scanning) {
      return;
    }

    scanning = true;

    try {

      const result = await scanForCriticalAlerts(app.prisma, app.tracking3d);

      if (result.stored > 0) {

        app.log.info(
          { result },
          "Critical alerts: nuevos eventos detectados y guardados"
        );

      } else {

        app.log.debug(
          { result },
          "Critical alerts: escaneo completado sin eventos nuevos"
        );
      }

    } catch (error) {

      app.log.error(
        error,
        "Critical alerts: falló el escaneo automático"
      );

    } finally {

      scanning = false;
    }
  };

  const timer = setInterval(runScan, intervalSeconds * 1000);

  app.addHook("onClose", async () => {
    clearInterval(timer);
  });

  app.log.info(
    `Critical alerts: escaneo automático activo cada ${intervalSeconds}s`
  );

  // Primer escaneo inmediato al arrancar, sin esperar el primer intervalo.
  runScan();
});
