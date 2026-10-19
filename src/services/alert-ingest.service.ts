import { PrismaClient } from "@prisma/client";

/**
 * Empresas habilitadas para guardar alertas — hoy, solo DADA-DADA.
 * Único lugar donde vive esta constante (antes estaba duplicada en
 * webhooks-3dt.ts y critical-alert.service.ts por separado).
 */
export const ENABLED_CLIENT_COMPANY_UIDS = new Set(["2C809B"]);

export interface IngestAlertInput {
  unitName: string;
  alertName: string | null;
  occurredAt: Date;
  description: string | null;
  address: string | null;
  driverName: string | null;
}

export interface IngestAlertResult {
  stored: boolean;
  eventId?: number;
  reason?: string;
}

/**
 * Guarda un evento de alerta crítica a partir de un nombre de unidad
 * + nombre de alerta "en crudo" (como los manda 3Dtracking, por
 * webhook o por este nuevo polling de Alerts/List) — centraliza la
 * lógica que antes vivía solo en webhooks-3dt.ts:
 *
 * - Match de unidad por nombre/placa/externalId, con reintento
 *   recortando un sufijo entre paréntesis (3Dtracking agrega cosas
 *   como "(Telemetria)" según el canal de origen — ver incidente
 *   2026-10-06, "Telefono Mauricio" vs "Telefono Mauricio
 *   (Telemetria)").
 * - Alcance por empresa (ENABLED_CLIENT_COMPANY_UIDS).
 * - Alta automática del tipo de alerta en el catálogo si no existe
 *   (código WEBHOOK_<NOMBRE>, desactivado para WhatsApp por defecto
 *   — pedido explícito del usuario 2026-10-09).
 * - whatsappStatus nace "not_configured" (no null) si el tipo no
 *   tiene el WhatsApp habilitado en este momento, para que habilitarlo
 *   más tarde no dispare de golpe todo lo viejo (ver incidente
 *   2026-10-09).
 * - Duplicados (mismo unitUid+alertTypeCode+occurredAt) se resuelven
 *   silenciosos vía el unique constraint (P2002), no son error.
 */
export async function ingestAlertEvent(
  prisma: PrismaClient,
  input: IngestAlertInput
): Promise<IngestAlertResult> {

  /**
   * 3Dtracking agrega un sufijo al nombre de la unidad según la
   * fuente: entre paréntesis para el canal ("Telefono Mauricio
   * (Telemetria)") o entre corchetes para el conductor asignado
   * ("KIA RIO [Eduardo Hernández - 77293871]", visto en Alerts/List
   * de la API v2) — se recorta cualquiera de los dos al final del
   * string antes de buscar coincidencia.
   */
  const strippedUnitName = input.unitName.replace(/\s*[([][^)\]]*[)\]]\s*$/, "").trim();

  const unit = await prisma.unit.findFirst({
    where: {
      OR: [
        { name: { contains: input.unitName } },
        { plate: { contains: input.unitName } },
        { externalId: input.unitName },
        ...(strippedUnitName && strippedUnitName !== input.unitName
          ? [
              { name: { contains: strippedUnitName } },
              { plate: { contains: strippedUnitName } },
              { externalId: strippedUnitName }
            ]
          : [])
      ]
    },
    select: { externalId: true, name: true, companyUid: true }
  });

  if (!unit) {
    return { stored: false, reason: "unidad no encontrada" };
  }

  if (!unit.companyUid || !ENABLED_CLIENT_COMPANY_UIDS.has(unit.companyUid)) {
    return { stored: false, reason: "empresa fuera de alcance" };
  }

  const company = await prisma.company.findUnique({
    where: { uid: unit.companyUid },
    select: { contactPhone: true }
  });

  const matchedType = input.alertName
    ? await prisma.criticalAlertType.findFirst({
        where: { name: { contains: input.alertName } },
        select: { code: true, name: true }
      })
    : null;

  const alertTypeCode =
    matchedType?.code ||
    `WEBHOOK_${(input.alertName || "UNKNOWN").toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 40)}`;

  if (!matchedType && input.alertName) {

    await prisma.criticalAlertType.upsert({
      where: { code: alertTypeCode },
      create: {
        code: alertTypeCode,
        name: input.alertName,
        description: "Descubierta automáticamente",
        matchSystemName: null,
        active: true
      },
      update: {}
    });
  }

  const allowedType = await prisma.allowedAlertType.findUnique({
    where: { alertTypeCode }
  });

  try {

    const created = await prisma.criticalAlertEvent.create({
      data: {
        alertTypeCode,
        alertTypeName: input.alertName || matchedType?.name || "Alerta de 3Dtracking",
        unitUid: unit.externalId,
        unitName: unit.name,
        companyUid: unit.companyUid,
        contactPhone: company?.contactPhone || null,
        driverName: input.driverName,
        address: input.address,
        description: input.description,
        occurredAt: input.occurredAt,
        whatsappStatus: allowedType ? null : "not_configured"
      }
    });

    return { stored: true, eventId: created.id };

  } catch (error) {

    if ((error as { code?: string })?.code === "P2002") {
      return { stored: false, reason: "duplicado" };
    }

    throw error;
  }
}
