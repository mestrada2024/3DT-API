import { PrismaClient } from "@prisma/client";

import { Tracking3DService } from "../integrations/3dtracking/tracking.service";
import { Tracking3DPositionListEntry } from "../integrations/3dtracking/tracking.types";

export interface CriticalAlertScanResult {
  pagesProcessed: number;
  positionsChecked: number;
  alertTypesChecked: number;
  detected: number;
  stored: number;
  duplicates: number;
  skippedOtherCompany: number;
}

const CURSOR_ID = 1;
const MAX_PAGES_PER_RUN = 25;

/**
 * De momento solo trabajamos con DADA-DADA (uid 2C809B) — no se debe
 * ni siquiera GUARDAR CriticalAlertEvent para otras empresas hasta
 * que el usuario confirme agregarlas (instrucción explícita,
 * 2026-09-18). Antes de esto solo se restringía contactPhone; ahora
 * el evento completo se descarta para cualquier otra empresa, aunque
 * matchee una alarma permitida (ver AllowedAlertType). Si
 * companyUid es null (unidad sin empresa asignada localmente)
 * tampoco se guarda — fail-closed.
 */
const ENABLED_CLIENT_COMPANY_UIDS = new Set(["2C809B"]);

/**
 * Escanea el stream cronológico de posiciones de 3Dtracking
 * (Data/PositionsList, paginado por StartId, con InputOutputs incluido)
 * contra los tipos de alerta crítica activos que tengan matchSystemName
 * definido (ver docs/critical-alerts.md).
 *
 * Se usa Data/PositionsList en vez de Units/LatestPositionsList por dos
 * razones confirmadas con datos reales:
 * 1. LatestPositionsList solo expone la posición MÁS RECIENTE de cada
 *    unidad — una señal puntual como el botón de pánico vuelve a
 *    Active:false en el siguiente reporte de posición, así que si el
 *    escaneo no cae justo en ese mensaje, el evento se pierde para
 *    siempre. PositionsList expone cada mensaje individual, así que el
 *    mensaje exacto donde Active:true nunca se pierde.
 * 2. LatestPositionsList puede quedar bloqueado por límite de tasa
 *    (429) en cuentas con mucho tráfico — PositionsList no mostró ese
 *    problema en las mismas condiciones.
 *
 * El cursor (StartId) se persiste en CriticalAlertScanCursor para que
 * cada corrida continúe justo donde quedó la anterior, sin reprocesar
 * ni perder mensajes entre corridas. Si no hay cursor (primera vez),
 * arranca ~24 horas atrás (comportamiento default de 3Dtracking al
 * omitir StartId).
 *
 * Deduplicado por (unitUid, alertTypeCode, occurredAt).
 */
export async function scanForCriticalAlerts(
  prisma: PrismaClient,
  tracking3d: Tracking3DService
): Promise<CriticalAlertScanResult> {

  /**
   * Solo se vigilan señales cuyo código esté en AllowedAlertType (lista
   * de alarmas permitidas, decisión de negocio — hoy solo
   * PANIC_BUTTON) además de activas en el catálogo. Antes se vigilaban
   * los 11 tipos del catálogo completo, lo que acumuló miles de
   * eventos irrelevantes (ej. puerta del motorista) — limpiado el
   * 2026-09-18.
   */
  const allowed = await prisma.allowedAlertType.findMany({
    select: { alertTypeCode: true }
  });

  const allowedCodes = allowed.map((a) => a.alertTypeCode);

  const alertTypes = allowedCodes.length
    ? await prisma.criticalAlertType.findMany({
        where: {
          active: true,
          matchSystemName: { not: null },
          code: { in: allowedCodes }
        }
      })
    : [];

  const result: CriticalAlertScanResult = {
    pagesProcessed: 0,
    positionsChecked: 0,
    alertTypesChecked: alertTypes.length,
    detected: 0,
    stored: 0,
    duplicates: 0,
    skippedOtherCompany: 0
  };

  if (alertTypes.length === 0) {
    return result;
  }

  const alertTypesBySystemName = new Map(
    alertTypes.map((alertType) => [alertType.matchSystemName as string, alertType])
  );

  const cursor = await prisma.criticalAlertScanCursor.findUnique({
    where: { id: CURSOR_ID }
  });

  let startId = cursor?.startId.toString();

  for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {

    const raw = await tracking3d.getPositionsList({
      startId,
      includeInputOutputs: true
    });

    const positions: Tracking3DPositionListEntry[] = raw?.Result?.Position || [];
    const newStartId: string | undefined =
      raw?.Result?.StartId !== undefined && raw?.Result?.StartId !== null
        ? String(raw.Result.StartId)
        : undefined;

    result.pagesProcessed++;
    result.positionsChecked += positions.length;

    if (positions.length > 0) {

      const unitUids = [...new Set(
        positions
          .map((p) => p.Unit?.Uid)
          .filter((uid): uid is string => Boolean(uid))
      )];

      const localUnits = await prisma.unit.findMany({
        where: { externalId: { in: unitUids } },
        select: { externalId: true, companyUid: true }
      });

      const companyUidByUnit = new Map(
        localUnits.map((u) => [u.externalId, u.companyUid])
      );

      /**
       * Teléfono de contacto de la empresa (Company.contactPhone) —
       * se guarda en el mismo registro de la alarma para que el
       * futuro servicio de envío de WhatsApp lo use directo, sin
       * tener que volver a resolverlo. Se busca en lote (una sola
       * query) para las empresas presentes en esta página. Ya no hace
       * falta filtrar por ENABLED_CLIENT_COMPANY_UIDS acá — el evento
       * completo se descarta más abajo para cualquier empresa que no
       * sea DADA-DADA, así que lo que llegue a este punto ya es
       * DADA-DADA.
       */
      const companyUidsInPage = [...new Set(
        [...companyUidByUnit.values()].filter((uid): uid is string => Boolean(uid))
      )];

      const companies = companyUidsInPage.length
        ? await prisma.company.findMany({
            where: { uid: { in: companyUidsInPage } },
            select: { uid: true, contactPhone: true }
          })
        : [];

      const contactPhoneByCompany = new Map(
        companies.map((c) => [c.uid, c.contactPhone])
      );

      for (const position of positions) {

        const unit = position.Unit;

        if (!unit?.Uid || !position.InputOutputs?.length) {
          continue;
        }

        const occurredAtRaw = position.GPSTimeUtc || position.ServerTimeUTC;

        if (!occurredAtRaw) {
          continue;
        }

        const occurredAt = new Date(occurredAtRaw);

        for (const io of position.InputOutputs) {

          if (!io.Active || !io.SystemName) {
            continue;
          }

          const alertType = alertTypesBySystemName.get(io.SystemName);

          if (!alertType) {
            continue;
          }

          result.detected++;

          const companyUid = companyUidByUnit.get(unit.Uid) || null;

          if (!companyUid || !ENABLED_CLIENT_COMPANY_UIDS.has(companyUid)) {
            result.skippedOtherCompany++;
            continue;
          }

          try {

            await prisma.criticalAlertEvent.create({
              data: {
                alertTypeCode: alertType.code,
                alertTypeName: alertType.name,
                unitUid: unit.Uid,
                unitName: unit.Name || null,
                unitImei: unit.Imei || null,
                companyUid,
                contactPhone: contactPhoneByCompany.get(companyUid) || null,
                driverName: position.Driver
                  ? [position.Driver.FirstName, position.Driver.LastName].filter(Boolean).join(" ") || position.Driver.Code || null
                  : null,
                latitude: position.Latitude,
                longitude: position.Longitude,
                address: position.Address || null,
                speed: position.Speed,
                heading: position.Heading,
                description: io.UserDescription || io.Description || null,
                occurredAt
              }
            });

            result.stored++;

          } catch (error) {
            if ((error as { code?: string })?.code === "P2002") {
              result.duplicates++;
            } else {
              throw error;
            }
          }
        }
      }
    }

    if (newStartId) {

      await prisma.criticalAlertScanCursor.upsert({
        where: { id: CURSOR_ID },
        create: { id: CURSOR_ID, startId: BigInt(newStartId) },
        update: { startId: BigInt(newStartId) }
      });
    }

    if (!newStartId || newStartId === startId || positions.length === 0) {
      break;
    }

    startId = newStartId;
  }

  return result;
}
