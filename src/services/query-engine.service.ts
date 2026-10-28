import { PrismaClient } from "@prisma/client";

import { Tracking3DService } from "../integrations/3dtracking/tracking.service";
import { Alerts3DClient } from "../integrations/3dtracking/alerts.client";
import { getAllowedCompanyUids } from "./access-control.service";
import { startOfLocalDay } from "./report-pdf.service";

/**
 * Motor de consultas del futuro chatbot — primera versión pedida por
 * el usuario 2026-10-26: "la IA debería tomar palabras clave y
 * enviar la consulta a la tabla indicada, en caso no se encuentre en
 * la tabla local, hacer la consulta en 3dt". No hay integración con
 * OpenAI todavía (sin OPENAI_API_KEY, sin dependencia en
 * package.json), así que la "IA" de esta primera versión es un router
 * por palabras clave (regex) — reemplazable después por function-
 * calling real sin tocar la capa de consultas (routeQuery queda igual,
 * solo cambia quién decide el dominio).
 *
 * Alcance v1 (decidido con el usuario): alertas y ubicación/posición
 * de unidades. Tickets y FAQ NO entran acá — no tienen equivalente en
 * 3Dtracking, así que no hay "fallback externo" que routear.
 */

export type QueryDomain = "reporte" | "envivo" | "recorrido" | "combustible" | "alertas" | "estado" | "ubicacion" | "desconocido";
export type QuerySource = "local" | "3dt_fallback" | "not_found" | "forbidden";

export interface QueryEngineResult {
  domain: QueryDomain;
  source: QuerySource;
  matchedUnit: { uid: string; name: string } | null;
  message: string;
  data: unknown;
  warnings: string[];
}

/**
 * Combustible (2026-10-26, ejemplo real ticket #7: "CV200
 * conbustible") — raíces, para cubrir "combustible"/"conbustible",
 * "gasolina", "galones", etc. Va antes que alertas: "alertas de
 * combustible" se responde acá, filtrando a alertas de combustible.
 */
/**
 * Reporte PDF de un vehículo (pedido 2026-10-26) — va primero de
 * todo: "reporte de combustible de X" es un pedido de reporte.
 */
const REPORT_KEYWORDS = ["reporte", "informe", "pdf"];

const MAX_REPORT_DAYS = 31;

/**
 * Link efímero de seguimiento en vivo (2026-10-27) — va después de
 * reporte y antes que ubicación: "link de la ubicación en tiempo real
 * de cv200" es un pedido de link, no de la posición puntual.
 */
const LIVE_LINK_KEYWORDS = ["en vivo", "tiempo real", "link", "enlace", "compartir", "seguimiento"];

/**
 * Recorrido histórico en mapa (2026-10-27, ejemplo real: "recorrido
 * telefono mauricio del 26/10/2026") — después de envivo ("recorrido
 * en tiempo real" es un link en vivo) y antes que ubicación.
 */
const ROUTE_KEYWORDS = ["recorrido", "ruta", "trayecto", "por donde anduvo", "por donde paso", "historial de ubicacion"];

const MAX_ROUTE_DAYS = 7;

const FUEL_KEYWORDS = ["combustib", "conbustib", "gasolin", "diesel", "tanque", "galon"];

const FUEL_ALERT_CODES = ["FUEL_REFILL", "FUEL_THEFT_SUSPECTED"];

const ALERT_KEYWORDS = ["alerta", "alertas", "panico", "emergencia", "sos"];
/**
 * "Estado del vehículo" — agregado 2026-10-26 (ejemplo real: ticket
 * #7, "quiero saber el estado del vehículo Telefono Mauricio"). Se
 * evalúa antes que ubicación porque "estado del gps" es una pregunta
 * de estado, no de posición.
 */
const STATUS_KEYWORDS = [
  "estado",
  "status",
  "encendid",
  "apagad",
  "motor",
  "bateria",
  "velocidad",
  "reportando"
];

/** Mismo umbral que RastreoView (STALE_AFTER_MS): sin posición en 30
 * min se considera "sin reportar". */
const REPORTING_THRESHOLD_MINUTES = 30;

const LOCATION_KEYWORDS = [
  "donde",
  "ubicacion",
  "posicion",
  "gps",
  "localizacion"
];

/** Umbral de "dato local todavía fresco" — unit-live-status-scheduler
 * corre cada 60s, así que en condiciones normales esto nunca se
 * cumple; solo dispara el fallback si esa sincronización lleva un
 * rato caída. */
const STALE_POSITION_MINUTES = 5;

/** Mínimo de caracteres para que un nombre/placa cuente como
 * coincidencia — evita falsos positivos con nombres de 1-2 letras. */
const MIN_UNIT_MATCH_LENGTH = 3;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

function classifyDomain(normalizedText: string): QueryDomain {

  if (REPORT_KEYWORDS.some((kw) => normalizedText.includes(kw))) {
    return "reporte";
  }

  if (LIVE_LINK_KEYWORDS.some((kw) => normalizedText.includes(kw))) {
    return "envivo";
  }

  if (ROUTE_KEYWORDS.some((kw) => normalizedText.includes(kw))) {
    return "recorrido";
  }

  if (FUEL_KEYWORDS.some((kw) => normalizedText.includes(kw))) {
    return "combustible";
  }

  if (ALERT_KEYWORDS.some((kw) => normalizedText.includes(kw))) {
    return "alertas";
  }

  if (STATUS_KEYWORDS.some((kw) => normalizedText.includes(kw))) {
    return "estado";
  }

  if (LOCATION_KEYWORDS.some((kw) => normalizedText.includes(kw))) {
    return "ubicacion";
  }

  return "desconocido";
}

interface DateRange {
  gte: Date;
  lte: Date;
  label: string;
}

/** Rango de fechas a partir de palabras clave en el texto — null si
 * no se pidió ningún período (2026-10-26: "últimas 5 alertas" son las
 * 5 más recientes, sin importar la fecha; antes el default era 30
 * días). */
function extractDateRange(normalizedText: string): DateRange | null {

  const now = new Date();

  if (normalizedText.includes("hoy")) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { gte: start, lte: now, label: "hoy" };
  }

  if (normalizedText.includes("ayer")) {
    const start = new Date(now);
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { gte: start, lte: end, label: "ayer" };
  }

  if (normalizedText.includes("semana")) {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { gte: start, lte: now, label: "última semana" };
  }

  if (normalizedText.includes("mes")) {
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { gte: start, lte: now, label: "último mes" };
  }

  return null;
}

const DEFAULT_ALERT_LIMIT = 5;
const MAX_ALERT_LIMIT = 50;

const NUMBER_WORDS: Record<string, number> = {
  una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7,
  ocho: 8, nueve: 9, diez: 10, quince: 15, veinte: 20, treinta: 30, cincuenta: 50
};

/**
 * Cantidad pedida ("últimas 10 alertas", "3 alertas", "las diez
 * últimas") — default 5, tope 50. Solo cuenta un número pegado a
 * "últimas/primeras/alertas", para no confundir dígitos de una placa
 * (ej. "609BYW") con una cantidad.
 */
function extractLimit(normalizedText: string): number {

  const numberPattern = `(\\d{1,3}|${Object.keys(NUMBER_WORDS).join("|")})`;

  const patterns = [
    new RegExp(`\\b(?:ultim[oa]s?|primer[oa]s?|top)\\s+${numberPattern}\\b`),
    new RegExp(`\\b${numberPattern}\\s+(?:ultim[oa]s?\\s+)?alertas?\\b`)
  ];

  for (const pattern of patterns) {

    const match = normalizedText.match(pattern);

    if (match) {
      const value = NUMBER_WORDS[match[1]] ?? parseInt(match[1], 10);
      if (value >= 1) return Math.min(value, MAX_ALERT_LIMIT);
    }
  }

  return DEFAULT_ALERT_LIMIT;
}

/**
 * Palabras de la consulta que no pueden ser nombre de unidad — sin
 * esto, matchUnit (que compara substrings en ambos sentidos) llegaba
 * a calzar "alertas" o "ultimas" con unidades de nombre corto.
 */
const QUERY_STOPWORDS = new Set([
  "alerta", "alertas", "ultima", "ultimas", "ultimo", "ultimos", "primeras", "primeros",
  "compania", "companias", "empresa", "empresas", "cliente", "vehiculo", "vehiculos",
  "unidad", "unidades", "quiero", "saber", "ver", "dame", "muestrame", "mostrar",
  "cuales", "son", "mis", "las", "los", "del", "que", "por", "favor", "hoy", "ayer",
  "semana", "mes", "estado", "donde", "esta", "panico", "emergencia", "top",
  "combustible", "conbustible", "gasolina", "diesel", "tanque", "galones", "nivel",
  "busca", "buscar", "recarga", "recargas", "robo", "extraccion",
  "reporte", "informe", "pdf", "genera", "generar", "generame", "desde", "hasta",
  "rango", "fecha", "fechas", "periodo", "dia", "dias", "enviar", "envia", "manda",
  "vivo", "tiempo", "real", "link", "enlace", "compartir", "comparte", "seguimiento",
  "ubicacion", "posicion", "recorrido", "ruta", "rastreo", "rastrear", "hora", "horas",
  "minuto", "minutos", "media", "durante", "para",
  ...Object.keys(NUMBER_WORDS)
]);

/** Fechas escritas en el mensaje: dd/mm[/aaaa], dd-mm[-aaaa] o
 * aaaa-mm-dd. Se usan para el rango del reporte y se quitan del texto
 * antes de buscar la unidad. */
const DATE_PATTERN = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b|\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/g;

interface ReportRange {
  from: Date;
  to: Date;
}

/**
 * Rango del reporte en días completos, hora de El Salvador. Acepta
 * una o dos fechas ("del 01/10/2026 al 15/10/2026", "1/10 al 15/10",
 * "2026-10-01 a 2026-10-15", "el 05/10") o hoy/ayer/semana/mes. Sin
 * año se asume el actual (o el anterior si la fecha quedaría en el
 * futuro). Devuelve un string con el error si las fechas no sirven.
 */
function extractReportRange(normalizedText: string): ReportRange | string | null {

  const nowLocal = new Date(Date.now() - 6 * 3600000);
  const todayY = nowLocal.getUTCFullYear();
  const todayM = nowLocal.getUTCMonth() + 1;
  const todayD = nowLocal.getUTCDate();
  const todayStart = startOfLocalDay(todayY, todayM, todayD);
  const dayMs = 24 * 3600000;

  const found: Date[] = [];

  for (const match of normalizedText.matchAll(DATE_PATTERN)) {

    let year: number;
    let month: number;
    let day: number;

    if (match[1]) {
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
    } else {
      day = Number(match[4]);
      month = Number(match[5]);
      year = match[6] ? Number(match[6]) : todayY;
      if (year < 100) year += 2000;
      if (!match[6] && startOfLocalDay(year, month, day) > todayStart) year -= 1;
    }

    const date = startOfLocalDay(year, month, day);
    const check = new Date(date.getTime() + 6 * 3600000);

    if (month < 1 || month > 12 || check.getUTCDate() !== day) {
      return `La fecha "${match[0]}" no es válida. Usá el formato dd/mm/aaaa.`;
    }

    found.push(date);
  }

  let from: Date;
  let to: Date;

  if (found.length >= 2) {
    [from, to] = found[0] <= found[1] ? [found[0], found[1]] : [found[1], found[0]];
  } else if (found.length === 1) {
    from = found[0];
    to = found[0];
  } else if (normalizedText.includes("hoy")) {
    from = todayStart;
    to = todayStart;
  } else if (normalizedText.includes("ayer")) {
    from = new Date(todayStart.getTime() - dayMs);
    to = from;
  } else if (normalizedText.includes("semana")) {
    from = new Date(todayStart.getTime() - 6 * dayMs);
    to = todayStart;
  } else if (normalizedText.includes("mes")) {
    from = new Date(todayStart.getTime() - 29 * dayMs);
    to = todayStart;
  } else {
    return null;
  }

  const toEnd = new Date(to.getTime() + dayMs - 1);
  const days = Math.round((toEnd.getTime() + 1 - from.getTime()) / dayMs);

  if (days > MAX_REPORT_DAYS) {
    return `El rango pedido es de ${days} días; el máximo por reporte es ${MAX_REPORT_DAYS}.`;
  }

  if (from > new Date()) {
    return "El rango pedido está en el futuro.";
  }

  return { from, to: toEnd };
}

function compact(text: string): string {
  return normalize(text).replace(/[^a-z0-9]/g, "");
}

interface CandidateCompany {
  uid: string;
  name: string;
}

/**
 * Compañía nombrada en el texto ("compañía dada-dada"), solo entre las
 * permitidas al usuario. Se compara sin espacios ni signos para que
 * "dada-dada", "dada dada" y "DADA-DADA" calcen igual, y se exige el
 * nombre completo (no una palabra suelta): "dada" solo NO elige entre
 * DADA-DADA y DADA KONTROL. Gana el nombre más largo.
 */
function matchCompany(normalizedText: string, companies: CandidateCompany[]): CandidateCompany | null {

  const compactText = compact(normalizedText);
  let best: CandidateCompany | null = null;

  for (const company of companies) {

    const compactName = compact(company.name);

    if (compactName.length < 4 || !compactText.includes(compactName)) {
      continue;
    }

    if (!best || compactName.length > compact(best.name).length) {
      best = company;
    }
  }

  return best;
}

/** Texto para buscar la unidad: sin las palabras de la compañía ya
 * identificada ni las palabras de la consulta en sí. */
function unitSearchText(normalizedText: string, company: CandidateCompany | null): string {

  const companyWords = new Set(company ? normalize(company.name).split(/[^a-z0-9]+/) : []);

  return normalizedText
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !QUERY_STOPWORDS.has(word) && !companyWords.has(word))
    .join(" ");
}

interface CandidateUnit {
  id: number;
  externalId: string;
  name: string;
  plate: string | null;
  companyUid: string | null;
  latitude: unknown;
  longitude: unknown;
  speed: unknown;
  batteryLevel: unknown;
  status: string;
  lastPositionAt: Date | null;
  lastFuelLevel: unknown;
  lastFuelLevelAt: Date | null;
}

/** Separa en palabras alfanuméricas, descartando las muy cortas
 * (mismo umbral que MIN_UNIT_MATCH_LENGTH) para no matchear ruido. */
function tokenize(text: string): string[] {
  return text
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= MIN_UNIT_MATCH_LENGTH);
}

/**
 * Busca, entre las unidades permitidas para el usuario, la que mejor
 * calce con el texto. Muchas unidades tienen nombre compuesto (ej.
 * "609BYW ITL012 5LA") — comparar el texto completo contra el nombre
 * completo fallaba apenas el usuario escribía solo la placa o parte
 * del nombre (bug real encontrado en la primera prueba, 2026-10-26).
 * Por eso compara por palabra: cada palabra del texto contra cada
 * palabra del nombre/placa de la unidad, en cualquier dirección de
 * substring (cubre placas con prefijo, ej. "C609BYW" vs "609BYW"). Se
 * queda con la coincidencia de mayor longitud para reducir ambigüedad
 * si varias unidades calzan.
 */
function matchUnit(
  normalizedText: string,
  units: CandidateUnit[]
): CandidateUnit | null {

  const queryTokens = tokenize(normalizedText);

  let best: CandidateUnit | null = null;
  let bestScore = 0;

  for (const unit of units) {

    for (const candidate of [unit.name, unit.plate]) {

      if (!candidate) {
        continue;
      }

      const normalizedCandidate = normalize(candidate);

      if (normalizedCandidate.length < MIN_UNIT_MATCH_LENGTH) {
        continue;
      }

      if (normalizedText.includes(normalizedCandidate) && normalizedCandidate.length > bestScore) {
        best = unit;
        bestScore = normalizedCandidate.length;
        continue;
      }

      for (const candidateToken of tokenize(normalizedCandidate)) {

        for (const queryToken of queryTokens) {

          const matches =
            queryToken === candidateToken ||
            candidateToken.includes(queryToken) ||
            queryToken.includes(candidateToken);

          if (!matches) {
            continue;
          }

          const score = Math.max(queryToken.length, candidateToken.length);

          if (score > bestScore) {
            best = unit;
            bestScore = score;
          }
        }
      }
    }
  }

  return best;
}

async function resolveAlerts(
  prisma: PrismaClient,
  allowedCompanyUids: string[] | null,
  matchedUnit: CandidateUnit | null,
  matchedCompany: CandidateCompany | null,
  normalizedText: string
): Promise<QueryEngineResult> {

  const warnings: string[] = [];
  const range = extractDateRange(normalizedText);
  const limit = extractLimit(normalizedText);
  const periodLabel = range ? ` (${range.label})` : "";

  const where: {
    occurredAt?: { gte: Date; lte: Date };
    unitUid?: string;
    companyUid?: string | { in: string[] };
  } = {};

  if (range) {
    where.occurredAt = { gte: range.gte, lte: range.lte };
  }

  /**
   * Prioridad: unidad puntual > compañía nombrada > todo el alcance
   * del usuario. Una compañía no permitida ya se rechazó en
   * routeQuery, así que matchedCompany no abre alcance extra.
   */
  let scopeLabel: string;

  if (matchedUnit) {
    where.unitUid = matchedUnit.externalId;
    scopeLabel = ` de ${matchedUnit.name}`;
  } else if (matchedCompany) {
    where.companyUid = matchedCompany.uid;
    scopeLabel = ` de ${matchedCompany.name}`;
  } else {
    if (allowedCompanyUids !== null) {
      where.companyUid = { in: allowedCompanyUids };
    }
    // root sin unidad ni compañía: ve todas las empresas.
    scopeLabel = "";
  }

  const localAlerts = await prisma.criticalAlertEvent.findMany({
    where,
    orderBy: { occurredAt: "desc" },
    take: limit
  });

  if (localAlerts.length > 0) {

    return {
      domain: "alertas",
      source: "local",
      matchedUnit: matchedUnit
        ? { uid: matchedUnit.externalId, name: matchedUnit.name }
        : null,
      message: localAlerts.length < limit
        ? `Solo hay ${localAlerts.length} alerta(s)${scopeLabel}${periodLabel} (pediste ${limit}):`
        : `Últimas ${localAlerts.length} alerta(s)${scopeLabel}${periodLabel}:`,
      data: localAlerts,
      warnings
    };
  }

  /**
   * Fallback a apiv2.3dtracking.net solo si hay una unidad puntual
   * identificada — ese feed no viene filtrado por empresa del lado de
   * 3DT (ver alerts.client.ts), así que sin una unidad para filtrar
   * client-side se arriesgaría a mostrarle a un usuario alertas de
   * otra empresa. Sin unidad puntual, se reporta "no encontrado" en
   * vez de arriesgar una fuga de datos entre empresas.
   */
  if (!matchedUnit) {

    return {
      domain: "alertas",
      source: "not_found",
      matchedUnit: null,
      message: `No se encontraron alertas${scopeLabel}${periodLabel}.`,
      data: [],
      warnings
    };
  }

  try {

    const client = new Alerts3DClient();
    const session = await client.authenticate();
    const result = await client.getAlertList(session, null);

    const normalizedUnitName = normalize(matchedUnit.name);

    const externalAlerts = result.alerts.filter((alert) => {

      if (!alert.Vehicle) {
        return false;
      }

      const strippedVehicle = alert.Vehicle.replace(/\s*[([][^)\]]*[)\]]\s*$/, "").trim();

      return normalize(strippedVehicle).includes(normalizedUnitName);
    });

    warnings.push(
      "Fuente externa (apiv2.3dtracking.net): solo cubre las últimas 24h y es conocida por fallar intermitentemente (ErrorCode 50000)."
    );

    return {
      domain: "alertas",
      source: externalAlerts.length > 0 ? "3dt_fallback" : "not_found",
      matchedUnit: { uid: matchedUnit.externalId, name: matchedUnit.name },
      message:
        externalAlerts.length > 0
          ? `${externalAlerts.length} alerta(s) encontradas en 3Dtracking (fuente externa, últimas 24h) — no estaban en el sistema local.`
          : `Sin alertas locales${periodLabel} ni en la fuente externa de 3Dtracking (últimas 24h).`,
      data: externalAlerts.slice(0, limit),
      warnings
    };

  } catch (error) {

    warnings.push(
      `Fuente externa de 3Dtracking no disponible en este momento: ${(error as Error).message}`
    );

    return {
      domain: "alertas",
      source: "not_found",
      matchedUnit: { uid: matchedUnit.externalId, name: matchedUnit.name },
      message: `Sin alertas locales${periodLabel} y la fuente externa de 3Dtracking no respondió.`,
      data: [],
      warnings
    };
  }
}

async function resolveUbicacion(
  tracking3d: Tracking3DService,
  matchedUnit: CandidateUnit | null
): Promise<QueryEngineResult> {

  const warnings: string[] = [];

  if (!matchedUnit) {

    return {
      domain: "ubicacion",
      source: "not_found",
      matchedUnit: null,
      message: "No se identificó a qué unidad te referís — incluí el nombre o la placa en la consulta.",
      data: null,
      warnings
    };
  }

  const isStale =
    !matchedUnit.lastPositionAt ||
    Date.now() - matchedUnit.lastPositionAt.getTime() > STALE_POSITION_MINUTES * 60 * 1000;

  if (!isStale) {

    return {
      domain: "ubicacion",
      source: "local",
      matchedUnit: { uid: matchedUnit.externalId, name: matchedUnit.name },
      message: `Última posición conocida de ${matchedUnit.name} (sincronizada hace menos de ${STALE_POSITION_MINUTES} min).`,
      data: {
        latitude: matchedUnit.latitude,
        longitude: matchedUnit.longitude,
        speed: matchedUnit.speed,
        lastPositionAt: matchedUnit.lastPositionAt
      },
      warnings
    };
  }

  /**
   * Dato local ausente o viejo (la sincronización cada 60s lleva un
   * rato caída) — se intenta Data/PositionsList filtrado por Uid
   * (server-side, un solo vehículo), NO Units/LatestPositionsList
   * (bulk): ese endpoint bulk es el que ya dio 429 por límite de tasa
   * en producción (ver unit-live-status.service.ts) — una consulta
   * puntual de un chat no debería arriesgar ese límite otra vez.
   */
  try {

    const raw = await tracking3d.getPositionsList({ uid: matchedUnit.externalId });
    const positions = raw?.Result?.Position || [];
    const latest = positions[0];

    if (!latest) {

      warnings.push("La unidad no tiene posiciones recientes en 3Dtracking.");

      return {
        domain: "ubicacion",
        source: matchedUnit.lastPositionAt ? "local" : "not_found",
        matchedUnit: { uid: matchedUnit.externalId, name: matchedUnit.name },
        message: matchedUnit.lastPositionAt
          ? `Solo hay un dato local desactualizado de ${matchedUnit.name}.`
          : `No hay datos de posición de ${matchedUnit.name}, ni local ni en 3Dtracking.`,
        data: matchedUnit.lastPositionAt
          ? {
              latitude: matchedUnit.latitude,
              longitude: matchedUnit.longitude,
              speed: matchedUnit.speed,
              lastPositionAt: matchedUnit.lastPositionAt
            }
          : null,
        warnings
      };
    }

    warnings.push("El dato local estaba desactualizado — se consultó 3Dtracking en vivo.");

    return {
      domain: "ubicacion",
      source: "3dt_fallback",
      matchedUnit: { uid: matchedUnit.externalId, name: matchedUnit.name },
      message: `Posición en vivo de ${matchedUnit.name} (consultada directamente a 3Dtracking).`,
      data: {
        latitude: latest.Latitude ?? null,
        longitude: latest.Longitude ?? null,
        speed: latest.Speed ?? null,
        lastPositionAt: latest.GPSTimeUtc || latest.ServerTimeUTC || null
      },
      warnings
    };

  } catch (error) {

    warnings.push(`3Dtracking no respondió: ${(error as Error).message}`);

    return {
      domain: "ubicacion",
      source: matchedUnit.lastPositionAt ? "local" : "not_found",
      matchedUnit: { uid: matchedUnit.externalId, name: matchedUnit.name },
      message: matchedUnit.lastPositionAt
        ? `Solo hay un dato local desactualizado de ${matchedUnit.name} — 3Dtracking no respondió.`
        : `No hay datos de posición de ${matchedUnit.name} y 3Dtracking no respondió.`,
      data: matchedUnit.lastPositionAt
        ? {
            latitude: matchedUnit.latitude,
            longitude: matchedUnit.longitude,
            speed: matchedUnit.speed,
            lastPositionAt: matchedUnit.lastPositionAt
          }
        : null,
      warnings
    };
  }
}

/** Duración pedida para el link ("por 2 horas", "30 minutos", "media
 * hora") — null = default de live-share.service.ts (60 min). */
function extractLinkMinutes(normalizedText: string): number | null {

  if (normalizedText.includes("media hora")) return 30;

  const match = normalizedText.match(/\b(\d{1,4}|una|un|dos|tres|cuatro|seis|doce|veinticuatro)\s*(h|hr|hrs|horas?|min|minutos?)\b/);

  if (!match) return null;

  const words: Record<string, number> = { una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, seis: 6, doce: 12, veinticuatro: 24 };
  const value = words[match[1]] ?? parseInt(match[1], 10);

  return match[2].startsWith("m") ? value : value * 60;
}

/**
 * Link en vivo: solo valida la unidad. El link lo crea el chatbot
 * (createLiveShareLink) — mismo criterio que reporte: el motor no
 * tiene efectos secundarios.
 */
function resolveEnVivo(
  matchedUnit: CandidateUnit | null,
  normalizedText: string
): QueryEngineResult {

  if (!matchedUnit) {
    return {
      domain: "envivo",
      source: "not_found",
      matchedUnit: null,
      message: "Para compartir el seguimiento en vivo necesito el vehículo o la placa. Ejemplo: \"link en vivo de cv200 por 2 horas\".",
      data: null,
      warnings: []
    };
  }

  return {
    domain: "envivo",
    source: "local",
    matchedUnit: { uid: matchedUnit.externalId, name: matchedUnit.name },
    message: `Seguimiento en vivo de ${matchedUnit.name}`,
    data: { unitId: matchedUnit.id, minutes: extractLinkMinutes(normalizedText) },
    warnings: []
  };
}

/**
 * Recorrido histórico: valida unidad + rango (sin fecha = hoy, máximo
 * MAX_ROUTE_DAYS). El link y el resumen los arma el chatbot.
 */
function resolveRecorrido(
  matchedUnit: CandidateUnit | null,
  normalizedText: string
): QueryEngineResult {

  const example = "Ejemplo: \"recorrido de cv200 del 26/10/2026\" o \"recorrido de cv200 del 20/10 al 22/10\".";

  if (!matchedUnit) {
    return {
      domain: "recorrido",
      source: "not_found",
      matchedUnit: null,
      message: `Para mostrar el recorrido necesito el vehículo o la placa. ${example}`,
      data: null,
      warnings: []
    };
  }

  const parsed = extractReportRange(normalizedText);

  if (typeof parsed === "string") {
    return {
      domain: "recorrido",
      source: "not_found",
      matchedUnit: { uid: matchedUnit.externalId, name: matchedUnit.name },
      message: parsed,
      data: null,
      warnings: []
    };
  }

  const range = parsed ?? (extractReportRange("hoy") as ReportRange);
  const days = Math.round((range.to.getTime() + 1 - range.from.getTime()) / (24 * 3600000));

  if (days > MAX_ROUTE_DAYS) {
    return {
      domain: "recorrido",
      source: "not_found",
      matchedUnit: { uid: matchedUnit.externalId, name: matchedUnit.name },
      message: `El rango pedido es de ${days} días; para el mapa el máximo es ${MAX_ROUTE_DAYS}. Para períodos más largos pedí un reporte PDF.`,
      data: null,
      warnings: []
    };
  }

  return {
    domain: "recorrido",
    source: "local",
    matchedUnit: { uid: matchedUnit.externalId, name: matchedUnit.name },
    message: `Recorrido de ${matchedUnit.name}`,
    data: { unitId: matchedUnit.id, from: range.from, to: range.to },
    warnings: []
  };
}

/**
 * Reporte: solo valida unidad + rango. El PDF lo arma el chatbot
 * (report-pdf.service.ts) — el motor de consultas no genera archivos
 * para que /query-engine/ask siga devolviendo solo JSON.
 */
function resolveReporte(
  matchedUnit: CandidateUnit | null,
  normalizedText: string
): QueryEngineResult {

  const example = "Ejemplo: \"reporte de cv200 del 01/10/2026 al 15/10/2026\".";

  if (!matchedUnit) {
    return {
      domain: "reporte",
      source: "not_found",
      matchedUnit: null,
      message: `Para generar el reporte necesito el vehículo o la placa. ${example}`,
      data: null,
      warnings: []
    };
  }

  const range = extractReportRange(normalizedText);

  if (range === null || typeof range === "string") {
    return {
      domain: "reporte",
      source: "not_found",
      matchedUnit: { uid: matchedUnit.externalId, name: matchedUnit.name },
      message: range ?? `Indicá el rango de fechas del reporte (máximo ${MAX_REPORT_DAYS} días). ${example}`,
      data: null,
      warnings: []
    };
  }

  return {
    domain: "reporte",
    source: "local",
    matchedUnit: { uid: matchedUnit.externalId, name: matchedUnit.name },
    message: `Reporte de ${matchedUnit.name}`,
    data: {
      unitId: matchedUnit.id,
      from: range.from,
      to: range.to
    },
    warnings: []
  };
}

/**
 * Combustible: nivel actual (Unit.lastFuelLevel, que alimenta
 * unit-live-status desde el sensor "Nivel de Combustible") + las
 * últimas alertas de combustible (recarga / posible extracción). Solo
 * datos locales: Data/SensorReadingsList filtrado por Uid no sirve
 * para historial puntual (devolvió 0 lecturas incluso para una
 * unidad con sensor, 2026-10-26 — mismo problema de cursor global
 * documentado para PositionsList).
 */
async function resolveCombustible(
  prisma: PrismaClient,
  allowedCompanyUids: string[] | null,
  matchedUnit: CandidateUnit | null,
  matchedCompany: CandidateCompany | null,
  normalizedText: string
): Promise<QueryEngineResult> {

  const range = extractDateRange(normalizedText);
  const limit = extractLimit(normalizedText);

  const where: {
    alertTypeCode: { in: string[] };
    occurredAt?: { gte: Date; lte: Date };
    unitUid?: string;
    companyUid?: string | { in: string[] };
  } = { alertTypeCode: { in: FUEL_ALERT_CODES } };

  if (range) {
    where.occurredAt = { gte: range.gte, lte: range.lte };
  }

  let scopeLabel = "";

  if (matchedUnit) {
    where.unitUid = matchedUnit.externalId;
    scopeLabel = matchedUnit.name;
  } else if (matchedCompany) {
    where.companyUid = matchedCompany.uid;
    scopeLabel = matchedCompany.name;
  } else if (allowedCompanyUids !== null) {
    where.companyUid = { in: allowedCompanyUids };
  }

  const alerts = await prisma.criticalAlertEvent.findMany({
    where,
    orderBy: { occurredAt: "desc" },
    take: limit
  });

  return {
    domain: "combustible",
    source: "local",
    matchedUnit: matchedUnit ? { uid: matchedUnit.externalId, name: matchedUnit.name } : null,
    message: scopeLabel ? `Combustible de ${scopeLabel}` : "Combustible",
    data: {
      unit: matchedUnit
        ? {
            fuelLevel: matchedUnit.lastFuelLevel,
            fuelLevelAt: matchedUnit.lastFuelLevelAt,
            lastPositionAt: matchedUnit.lastPositionAt
          }
        : null,
      alerts,
      limit,
      periodLabel: range?.label ?? null
    },
    warnings: []
  };
}

/**
 * Estado de una unidad con datos locales únicamente (Unit + la
 * última fila de Position para el motor) — sin llamar a 3Dtracking:
 * unit-live-status-scheduler ya sincroniza cada 60s, y si la unidad
 * no reporta hace rato eso mismo es la respuesta ("sin reportar
 * desde ..."), no un motivo para consultar en vivo.
 */
async function resolveEstado(
  prisma: PrismaClient,
  matchedUnit: CandidateUnit | null
): Promise<QueryEngineResult> {

  if (!matchedUnit) {

    return {
      domain: "estado",
      source: "not_found",
      matchedUnit: null,
      message: "No se identificó a qué unidad te referís — incluí el nombre o la placa en la consulta.",
      data: null,
      warnings: []
    };
  }

  const lastPosition = await prisma.position.findFirst({
    where: { unitId: matchedUnit.id },
    orderBy: { recordedAt: "desc" },
    select: { ignition: true }
  });

  const reporting =
    matchedUnit.lastPositionAt !== null &&
    Date.now() - matchedUnit.lastPositionAt.getTime() <= REPORTING_THRESHOLD_MINUTES * 60 * 1000;

  return {
    domain: "estado",
    source: "local",
    matchedUnit: { uid: matchedUnit.externalId, name: matchedUnit.name },
    message: `Estado de ${matchedUnit.name}.`,
    data: {
      accountStatus: matchedUnit.status,
      reporting,
      lastPositionAt: matchedUnit.lastPositionAt,
      ignition: lastPosition?.ignition ?? null,
      speed: matchedUnit.speed,
      batteryLevel: matchedUnit.batteryLevel,
      latitude: matchedUnit.latitude,
      longitude: matchedUnit.longitude
    },
    warnings: []
  };
}

export async function routeQuery(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  params: { text: string; userId: number; role: string }
): Promise<QueryEngineResult> {

  const normalizedText = normalize(params.text);
  const domain = classifyDomain(normalizedText);

  const allowedCompanyUids = await getAllowedCompanyUids(prisma, params.userId, params.role);

  if (allowedCompanyUids !== null && allowedCompanyUids.length === 0) {

    return {
      domain,
      source: "forbidden",
      matchedUnit: null,
      message: "Tu usuario no tiene empresas asignadas — no hay nada para consultar.",
      data: null,
      warnings: []
    };
  }

  const units = await prisma.unit.findMany({
    where: allowedCompanyUids === null ? {} : { companyUid: { in: allowedCompanyUids } },
    select: {
      id: true,
      externalId: true,
      name: true,
      plate: true,
      companyUid: true,
      latitude: true,
      longitude: true,
      speed: true,
      batteryLevel: true,
      status: true,
      lastPositionAt: true,
      lastFuelLevel: true,
      lastFuelLevelAt: true
    }
  });

  /**
   * Se busca entre TODAS las compañías para poder distinguir "nombró
   * una compañía que no es suya" (respuesta explícita de sin acceso)
   * de "no nombró ninguna" — sin esto, en la primera prueba real
   * ("alertas de dada kontrol" con un usuario de DADA-DADA) la palabra
   * "kontrol" terminaba calzando con una unidad propia de nombre
   * parecido y la respuesta confundía.
   */
  const companies = await prisma.company.findMany({
    select: { uid: true, name: true }
  });

  const matchedCompany = matchCompany(
    normalizedText,
    companies.filter((c): c is CandidateCompany => !!c.name)
  );

  if (
    (domain === "alertas" || domain === "combustible") &&
    matchedCompany &&
    allowedCompanyUids !== null &&
    !allowedCompanyUids.includes(matchedCompany.uid)
  ) {

    return {
      domain,
      source: "forbidden",
      matchedUnit: null,
      message: `No tenés acceso a la compañía ${matchedCompany.name}.`,
      data: null,
      warnings: []
    };
  }

  const searchText = unitSearchText(normalizedText.replace(DATE_PATTERN, " "), matchedCompany);
  const matchedUnit = matchUnit(searchText, units);

  /**
   * Nombró algo con forma de placa/código (letras + números, ej.
   * "C116877") que no es ninguna unidad suya — se dice explícitamente
   * en vez de responder con todo el alcance del usuario (pasó en la
   * prueba real 2026-10-26: una unidad de otra empresa devolvía las
   * alertas de combustible de toda DADA-DADA). No distingue "no
   * existe" de "es de otra empresa", a propósito.
   */
  const unknownIdentifier = searchText
    .split(" ")
    .find((word) => word.length >= 4 && /[a-z]/.test(word) && /[0-9]/.test(word));

  if (domain !== "desconocido" && !matchedUnit && !matchedCompany && unknownIdentifier) {

    return {
      domain,
      source: "not_found",
      matchedUnit: null,
      message: `No encontré la unidad "${unknownIdentifier.toUpperCase()}" entre tus vehículos.`,
      data: null,
      warnings: []
    };
  }

  if (domain === "alertas") {
    return resolveAlerts(prisma, allowedCompanyUids, matchedUnit, matchedCompany, normalizedText);
  }

  if (domain === "reporte") {
    return resolveReporte(matchedUnit, normalizedText);
  }

  if (domain === "envivo") {
    return resolveEnVivo(matchedUnit, normalizedText);
  }

  if (domain === "recorrido") {
    return resolveRecorrido(matchedUnit, normalizedText);
  }

  if (domain === "combustible") {
    return resolveCombustible(prisma, allowedCompanyUids, matchedUnit, matchedCompany, normalizedText);
  }

  if (domain === "estado") {
    return resolveEstado(prisma, matchedUnit);
  }

  if (domain === "ubicacion") {
    return resolveUbicacion(tracking3d, matchedUnit);
  }

  return {
    domain: "desconocido",
    source: "not_found",
    matchedUnit: matchedUnit ? { uid: matchedUnit.externalId, name: matchedUnit.name } : null,
    message:
      "No reconocí qué tipo de consulta es. Usá palabras como \"alerta\"/\"pánico\" para alertas, \"estado\" para el estado de una unidad, \"combustible\" para nivel y alertas de combustible, \"dónde está\"/\"ubicación\" para su posición, o \"reporte\" + fechas para un PDF.",
    data: null,
    warnings: []
  };
}
