import fp from "fastify-plugin";

import { Alerts3DClient } from "../integrations/3dtracking/alerts.client";
import { scanAlerts3D } from "../services/alerts3d-scan.service";

const DEFAULT_INTERVAL_SECONDS = 60;
const MIN_INTERVAL_SECONDS = 20;

/**
 * Ejecuta scanAlerts3D() en un intervalo recurrente — trae el feed de
 * Alerts/List de la API v2 de 3Dtracking (apiv2.3dtracking.net), que
 * cubre TODAS las categorías de alerta de la cuenta sin necesidad de
 * configurar un webhook por cada una (ver docs en alerts.client.ts).
 *
 * El endpoint tiene una inestabilidad conocida del lado de
 * 3Dtracking (ErrorCode 50000 intermitente) — cada corrida fallida
 * queda registrada en el log y se reintenta en la próxima, sin
 * avanzar el cursor ni perder alertas.
 *
 * Configurable por variables de entorno:
 * - ALERTS3D_SCAN_ENABLED=false   desactiva el escaneo automático
 * - ALERTS3D_SCAN_INTERVAL_SECONDS=60   cada cuánto escanear (mínimo 20)
 */
export default fp(async (app) => {

  const enabled = process.env.ALERTS3D_SCAN_ENABLED !== "false";

  if (!enabled) {

    app.log.info(
      "Alerts3D: escaneo automático desactivado (ALERTS3D_SCAN_ENABLED=false)"
    );

    return;
  }

  const intervalSeconds = Math.max(
    parseInt(
      process.env.ALERTS3D_SCAN_INTERVAL_SECONDS || String(DEFAULT_INTERVAL_SECONDS),
      10
    ) || DEFAULT_INTERVAL_SECONDS,
    MIN_INTERVAL_SECONDS
  );

  const client = new Alerts3DClient();

  let scanning = false;

  const runScan = async () => {

    if (scanning) {
      return;
    }

    scanning = true;

    try {

      const result = await scanAlerts3D(app.prisma, client);

      if (result.stored > 0) {

        app.log.info({ result }, "Alerts3D: nuevas alertas guardadas");

      } else {

        app.log.debug({ result }, "Alerts3D: escaneo completado sin alertas nuevas");
      }

    } catch (error) {

      app.log.warn(
        { message: (error as Error).message },
        "Alerts3D: falló el escaneo (se reintenta en la próxima corrida)"
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
    `Alerts3D: escaneo automático activo cada ${intervalSeconds}s`
  );

  runScan();
});
