import fp from "fastify-plugin";

import { dispatchPendingWhatsappAlerts } from "../services/whatsapp-dispatch.service";

const DEFAULT_INTERVAL_SECONDS = 60;
const MIN_INTERVAL_SECONDS = 15;
const ALERT_CONFIG_ID = 1;

/**
 * Ejecuta dispatchPendingWhatsappAlerts() en un intervalo recurrente,
 * para que las alertas nuevas se notifiquen por WhatsApp sin depender
 * de que alguien llame a POST /messaging/dispatch-alerts a mano —
 * mismo patrón que critical-alert-scheduler.ts.
 *
 * A diferencia del endpoint manual, este SÍ respeta
 * WhatsappAlertConfig.active — con active=false (default) el
 * scheduler corre pero no envía nada, para que activar el disparo
 * automático sea una decisión explícita desde el módulo Mensajería,
 * no un efecto secundario de desplegar este código.
 *
 * Configurable por variables de entorno:
 * - WHATSAPP_DISPATCH_ENABLED=false   desactiva el scheduler por completo
 * - WHATSAPP_DISPATCH_INTERVAL_SECONDS=60   cada cuánto revisar (mínimo 15)
 */
export default fp(async (app) => {

  const enabled = process.env.WHATSAPP_DISPATCH_ENABLED !== "false";

  if (!enabled) {

    app.log.info(
      "WhatsApp dispatch: scheduler desactivado (WHATSAPP_DISPATCH_ENABLED=false)"
    );

    return;
  }

  const intervalSeconds = Math.max(
    parseInt(
      process.env.WHATSAPP_DISPATCH_INTERVAL_SECONDS ||
        String(DEFAULT_INTERVAL_SECONDS),
      10
    ) || DEFAULT_INTERVAL_SECONDS,
    MIN_INTERVAL_SECONDS
  );

  let running = false;

  const runDispatch = async () => {

    if (running) {
      return;
    }

    running = true;

    try {

      const config = await app.prisma.whatsappAlertConfig.findUnique({
        where: { id: ALERT_CONFIG_ID }
      });

      if (!config?.active) {
        app.log.debug(
          "WhatsApp dispatch: omitido (WhatsappAlertConfig.active=false)"
        );
        return;
      }

      const result = await dispatchPendingWhatsappAlerts(app.prisma, app.dmsMessaging);

      if (result.sent > 0 || result.failed > 0) {

        app.log.info(
          { result },
          "WhatsApp dispatch: alertas procesadas"
        );

      } else {

        app.log.debug(
          { result },
          "WhatsApp dispatch: sin alertas pendientes"
        );
      }

    } catch (error) {

      app.log.error(
        error,
        "WhatsApp dispatch: falló la corrida automática"
      );

    } finally {

      running = false;
    }
  };

  const timer = setInterval(runDispatch, intervalSeconds * 1000);

  app.addHook("onClose", async () => {
    clearInterval(timer);
  });

  app.log.info(
    `WhatsApp dispatch: scheduler activo cada ${intervalSeconds}s (respeta WhatsappAlertConfig.active)`
  );

  runDispatch();
});
