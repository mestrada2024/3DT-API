import { FastifyPluginAsync } from "fastify";

interface WebhookParams {
  secret: string;
}

interface ParsedWebhookAlert {
  driverName: string | null;
  datetime: string | null;
  engineTime: string | null;
  alertHours: string | null;
  address: string | null;
  alertName: string | null;
  currentAuxiliaryLevel: string | null;
  measurementSign: string | null;
  unitName: string | null;
}

/**
 * Orden acordado con el usuario (2026-09-22) para la plantilla de
 * texto del webhook de 3Dtracking — una línea por campo, en este
 * orden exacto. Se usa como respaldo cuando el cuerpo no es JSON
 * válido (no confirmado con una llamada real todavía).
 */
const TEXT_TEMPLATE_FIELD_ORDER: (keyof ParsedWebhookAlert)[] = [
  "driverName",
  "datetime",
  "engineTime",
  "alertHours",
  "address",
  "alertName",
  "currentAuxiliaryLevel",
  "measurementSign",
  "unitName"
];

/**
 * Nombres de clave posibles por campo si 3Dtracking manda JSON — se
 * revisan sin distinguir mayúsculas/minúsculas, cubriendo tanto el
 * nombre "bonito" como el token [entre corchetes] que dio el usuario.
 */
const JSON_KEY_ALIASES: Record<keyof ParsedWebhookAlert, string[]> = {
  driverName: ["drivername", "driver_name", "driver"],
  datetime: ["datetime", "date_time"],
  engineTime: ["engine_time", "enginetime"],
  alertHours: ["alerts.content.hours", "hours", "alertshours"],
  address: ["address"],
  alertName: ["alertname", "alert_name"],
  currentAuxiliaryLevel: ["currentauxilliarylevel", "currentauxiliarylevel", "auxlevel"],
  measurementSign: ["measurementsign", "measurement_sign"],
  unitName: ["unitname", "unit_name", "unit"]
};

function tryParseJson(raw: string): ParsedWebhookAlert | null {

  let data: unknown;

  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!data || typeof data !== "object") {
    return null;
  }

  const lowerCaseMap = new Map<string, unknown>();

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    lowerCaseMap.set(key.toLowerCase(), value);
  }

  const result = {} as ParsedWebhookAlert;

  for (const field of TEXT_TEMPLATE_FIELD_ORDER) {

    const aliases = JSON_KEY_ALIASES[field];
    const found = aliases.map((alias) => lowerCaseMap.get(alias)).find((v) => v !== undefined);

    result[field] = found !== undefined && found !== null ? String(found) : null;
  }

  return result;
}

/**
 * Respaldo: el cuerpo es texto plano, una línea por campo, en el
 * orden de TEXT_TEMPLATE_FIELD_ORDER (según la plantilla que el
 * usuario describió: [drivername] [datetime] [engine_time]
 * {alerts.content.hours} [Address] [alertname]
 * [CurrentAuxilliaryLevel] [MeasurementSign] [unitname]).
 */
function parsePlainTextTemplate(raw: string): ParsedWebhookAlert {

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const result = {} as ParsedWebhookAlert;

  TEXT_TEMPLATE_FIELD_ORDER.forEach((field, index) => {
    result[field] = lines[index] || null;
  });

  return result;
}

/**
 * POST /api/v1/webhooks/3dt-alerts/:secret
 *
 * Recibe alarmas empujadas directamente por 3Dtracking (a diferencia
 * del resto del sistema, que las descubre sondeando
 * Data/PositionsList/SensorReadingsList) — 3Dtracking llama a este
 * endpoint cuando dispara una alerta configurada en su propio panel,
 * con el formato de plantilla de texto que el usuario compartió.
 *
 * No sabemos todavía el formato EXACTO que manda 3Dtracking (¿JSON?
 * ¿texto plano con esas 9 líneas?) — se intenta JSON primero, si no
 * se interpreta como texto plano posicional. El payload crudo
 * (headers + body) siempre se loguea completo
 * ("3DT_WEBHOOK_RECEIVED"), para poder ajustar el parseo en cuanto
 * llegue la primera llamada real.
 *
 * Sin autenticación JWT (3Dtracking no puede loguearse) — protegido
 * por un secreto en la URL (WEBHOOK_3DT_SECRET) en su lugar. Un
 * secreto incorrecto responde 404, no 401, para no confirmarle a
 * quien esté probando que el endpoint existe.
 *
 * Mismo alcance que el resto del sistema: solo se guarda si la
 * unidad reportada pertenece a una empresa en
 * ENABLED_CLIENT_COMPANY_UIDS (hoy, solo DADA-DADA).
 */
const webhooks3dtRoutes: FastifyPluginAsync = async (app) => {

  /**
   * Content-Type parser comodín, scoped a este plugin únicamente
   * (el encapsulamiento de Fastify hace que no afecte al resto de la
   * app) — no sabemos qué Content-Type va a mandar 3Dtracking, y el
   * parser de JSON por defecto de Fastify rechaza cualquier otro con
   * 415. Se lee el cuerpo crudo como texto sin importar el
   * Content-Type declarado.
   */
  app.addContentTypeParser("*", { parseAs: "string" }, (_request, body, done) => {
    done(null, body);
  });

  app.post<{
    Params: WebhookParams;
    Body: string;
  }>(
    "/webhooks/3dt-alerts/:secret",
    async (request, reply) => {

      const expectedSecret = process.env.WEBHOOK_3DT_SECRET;

      if (!expectedSecret || request.params.secret !== expectedSecret) {
        return reply.code(404).send();
      }

      const rawBody = typeof request.body === "string" ? request.body : JSON.stringify(request.body || "");

      console.log(
        "3DT_WEBHOOK_RECEIVED",
        JSON.stringify({
          headers: request.headers,
          contentType: request.headers["content-type"] || null,
          rawBody
        })
      );

      const parsed = tryParseJson(rawBody) || parsePlainTextTemplate(rawBody);

      if (!parsed.unitName) {
        app.log.warn({ parsed }, "3DT webhook: no se pudo identificar unitName en el payload");
        return reply.code(200).send({ success: true, stored: false, reason: "unitName no identificado" });
      }

      const unit = await app.prisma.unit.findFirst({
        where: {
          OR: [
            { name: { contains: parsed.unitName } },
            { plate: { contains: parsed.unitName } },
            { externalId: parsed.unitName }
          ]
        },
        select: { externalId: true, name: true, companyUid: true }
      });

      if (!unit) {
        app.log.warn({ unitName: parsed.unitName }, "3DT webhook: unidad no encontrada localmente");
        return reply.code(200).send({ success: true, stored: false, reason: "unidad no encontrada" });
      }

      const ENABLED_CLIENT_COMPANY_UIDS = new Set(["2C809B"]);

      if (!unit.companyUid || !ENABLED_CLIENT_COMPANY_UIDS.has(unit.companyUid)) {
        app.log.info(
          { unitName: unit.name, companyUid: unit.companyUid },
          "3DT webhook: empresa fuera de alcance, no se guarda"
        );
        return reply.code(200).send({ success: true, stored: false, reason: "empresa fuera de alcance" });
      }

      const company = await app.prisma.company.findUnique({
        where: { uid: unit.companyUid },
        select: { contactPhone: true }
      });

      const matchedType = parsed.alertName
        ? await app.prisma.criticalAlertType.findFirst({
            where: { name: { contains: parsed.alertName } },
            select: { code: true, name: true }
          })
        : null;

      const alertTypeCode =
        matchedType?.code ||
        `WEBHOOK_${(parsed.alertName || "UNKNOWN").toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 40)}`;

      const occurredAt = parsed.datetime && !isNaN(Date.parse(parsed.datetime))
        ? new Date(parsed.datetime)
        : new Date();

      const descriptionParts = [
        parsed.engineTime ? `Horas de motor: ${parsed.engineTime}` : null,
        parsed.alertHours ? `Horas de alerta: ${parsed.alertHours}` : null,
        parsed.currentAuxiliaryLevel
          ? `Nivel: ${parsed.currentAuxiliaryLevel}${parsed.measurementSign ? ` ${parsed.measurementSign}` : ""}`
          : null
      ].filter(Boolean);

      const description = descriptionParts.join(" — ").slice(0, 191) || null;

      try {

        const created = await app.prisma.criticalAlertEvent.create({
          data: {
            alertTypeCode,
            alertTypeName: parsed.alertName || matchedType?.name || "Alerta de 3Dtracking (webhook)",
            unitUid: unit.externalId,
            unitName: unit.name,
            companyUid: unit.companyUid,
            contactPhone: company?.contactPhone || null,
            driverName: parsed.driverName || null,
            address: parsed.address || null,
            description,
            occurredAt
          }
        });

        return reply.code(200).send({ success: true, stored: true, eventId: created.id });

      } catch (error) {

        if ((error as { code?: string })?.code === "P2002") {
          return reply.code(200).send({ success: true, stored: false, reason: "duplicado" });
        }

        app.log.error(error, "3DT webhook: error guardando el evento");
        return reply.code(200).send({ success: false, stored: false });
      }
    }
  );

};

export default webhooks3dtRoutes;
