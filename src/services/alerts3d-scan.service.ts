import { PrismaClient } from "@prisma/client";

import { Alerts3DClient, Alerts3DAlert } from "../integrations/3dtracking/alerts.client";
import { ingestAlertEvent } from "./alert-ingest.service";

const CURSOR_ID = 1;

export interface Alerts3DScanResult {
  fetched: number;
  stored: number;
  skipped: number;
  errors: number;
}

/**
 * Extrae la línea "Localización: ..." del AlertMessage de 3Dtracking
 * (texto libre, una línea por dato — ver ejemplo real en
 * alerts.client.ts) para poblar CriticalAlertEvent.address. Si no
 * aparece, queda null — no es crítico, el resto de la alerta igual
 * se guarda.
 */
function extractAddress(alertMessage: string | null): string | null {

  if (!alertMessage) {
    return null;
  }

  const match = alertMessage.match(/Localizaci[oó]n:\s*([^\r\n]+)/i);
  return match ? match[1].trim() : null;
}

/**
 * Trae el feed de Alerts/List de la API v2 de 3Dtracking
 * (apiv2.3dtracking.net) desde el último cursor guardado y guarda un
 * CriticalAlertEvent por cada alerta nueva, vía ingestAlertEvent
 * (mismo match de unidad/empresa/catálogo que usa el webhook).
 *
 * A diferencia del webhook (3Dtracking empuja solo lo que alguien
 * configuró explícitamente), este feed trae TODAS las alertas de la
 * cuenta sin configuración extra — confirmado con datos reales
 * 2026-10-09 (trajo alertas de "Alerta de Variación del Sensor" que
 * nunca llegaron por webhook).
 *
 * El cursor (Alerts3DScanCursor.startUid) solo avanza si la llamada
 * fue exitosa — si 3Dtracking devuelve error (ver inestabilidad
 * conocida del endpoint, ErrorCode 50000, en alerts.client.ts) se
 * deja el cursor donde estaba y se reintenta en la próxima corrida,
 * sin perder alertas ni duplicar trabajo.
 */
export async function scanAlerts3D(
  prisma: PrismaClient,
  client: Alerts3DClient
): Promise<Alerts3DScanResult> {

  const result: Alerts3DScanResult = { fetched: 0, stored: 0, skipped: 0, errors: 0 };

  const cursor = await prisma.alerts3DScanCursor.findUnique({ where: { id: CURSOR_ID } });

  const session = await client.authenticate();
  const { alerts, nextStartUid } = await client.getAlertList(session, cursor?.startUid);

  result.fetched = alerts.length;

  for (const alert of alerts as Alerts3DAlert[]) {

    if (!alert.Vehicle || !alert.CreatedDate) {
      result.skipped++;
      continue;
    }

    const occurredAt = new Date(alert.CreatedDate);

    if (isNaN(occurredAt.getTime())) {
      result.skipped++;
      continue;
    }

    try {

      const ingestResult = await ingestAlertEvent(prisma, {
        unitName: alert.Vehicle,
        alertName: alert.AlertName,
        occurredAt,
        description: alert.AlertMessage ? alert.AlertMessage.slice(0, 191) : null,
        address: extractAddress(alert.AlertMessage),
        driverName: null
      });

      if (ingestResult.stored) {
        result.stored++;
      } else {
        result.skipped++;
      }

    } catch {

      result.errors++;
    }
  }

  await prisma.alerts3DScanCursor.upsert({
    where: { id: CURSOR_ID },
    create: { id: CURSOR_ID, startUid: nextStartUid },
    update: { startUid: nextStartUid }
  });

  return result;
}
