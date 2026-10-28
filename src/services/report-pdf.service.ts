import PDFDocument from "pdfkit";
import { PrismaClient } from "@prisma/client";

import { getUnitTripsForRange } from "./unit-trips.service";

/**
 * Reporte PDF de un vehículo para un rango de fechas — lo genera el
 * chatbot cuando el cliente lo pide ("reporte de cv200 del 01/10 al
 * 15/10", pedido 2026-10-26) y se adjunta al mensaje del bot
 * (ChatAttachment). Solo datos locales: Position (viajes, km,
 * velocidad) y CriticalAlertEvent (alertas). Fechas y días en hora de
 * El Salvador (UTC-6 fijo, sin horario de verano).
 */

export const REPORT_TIMEZONE = "America/El_Salvador";
const REPORT_UTC_OFFSET_HOURS = -6;

const MAX_TRIPS_LISTED = 150;
const MAX_ALERTS_LISTED = 150;

const PAGE_MARGIN = 40;
const COLOR_TEXT = "#1a2433";
const COLOR_MUTED = "#667085";
const COLOR_PRIMARY = "#1d4ed8";
const COLOR_BORDER = "#e2e5e9";
const COLOR_HEADER_BG = "#f4f6f8";

export interface ReportUnit {
  id: number;
  externalId: string;
  name: string;
  plate: string | null;
  companyName: string | null;
}

/** Medianoche (hora SV) del día y/m/d, como instante UTC. */
export function startOfLocalDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, -REPORT_UTC_OFFSET_HOURS, 0, 0, 0));
}

function localDayKey(date: Date): string {
  const shifted = new Date(date.getTime() + REPORT_UTC_OFFSET_HOURS * 3600000);
  return shifted.toISOString().slice(0, 10);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("es-SV", { timeZone: REPORT_TIMEZONE, day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateTime(date: Date): string {
  return date.toLocaleString("es-SV", {
    timeZone: REPORT_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("es-SV", { timeZone: REPORT_TIMEZONE, hour: "2-digit", minute: "2-digit" });
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function formatKm(value: number): string {
  return `${value.toFixed(1)} km`;
}

function keyToDisplay(key: string): string {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

/** Tabla simple con salto de página y encabezado repetido. */
function drawTable(doc: PDFKit.PDFDocument, headers: string[], widths: number[], rows: string[][]) {

  const x0 = PAGE_MARGIN;
  const totalWidth = widths.reduce((a, b) => a + b, 0);
  const padding = 4;
  const bottomLimit = () => doc.page.height - PAGE_MARGIN - 20;

  const rowHeight = (cells: string[], font: string) => {
    doc.font(font).fontSize(8.5);
    return Math.max(
      ...cells.map((cell, i) => doc.heightOfString(cell, { width: widths[i] - padding * 2 }))
    ) + padding * 2;
  };

  const drawRow = (cells: string[], header: boolean) => {

    const font = header ? "Helvetica-Bold" : "Helvetica";
    const height = rowHeight(cells, font);

    if (doc.y + height > bottomLimit()) {
      doc.addPage();
      if (!header) drawRow(headers, true);
    }

    const y = doc.y;

    if (header) {
      doc.rect(x0, y, totalWidth, height).fill(COLOR_HEADER_BG);
    }

    doc.font(font).fontSize(8.5).fillColor(header ? COLOR_MUTED : COLOR_TEXT);

    let x = x0;
    cells.forEach((cell, i) => {
      doc.text(cell, x + padding, y + padding, { width: widths[i] - padding * 2 });
      x += widths[i];
    });

    doc.moveTo(x0, y + height).lineTo(x0 + totalWidth, y + height).strokeColor(COLOR_BORDER).lineWidth(0.5).stroke();
    doc.x = x0;
    doc.y = y + height;
  };

  drawRow(headers, true);
  rows.forEach((row) => drawRow(row, false));
  doc.moveDown(0.8);
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string) {

  if (doc.y > doc.page.height - PAGE_MARGIN - 80) {
    doc.addPage();
  }

  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").fontSize(12).fillColor(COLOR_PRIMARY).text(title, PAGE_MARGIN);
  doc.moveDown(0.3);
}

export async function buildUnitReportPdf(
  prisma: PrismaClient,
  unit: ReportUnit,
  from: Date,
  to: Date
): Promise<{ buffer: Buffer; fileName: string; summary: string }> {

  const [tripsResult, alerts] = await Promise.all([
    getUnitTripsForRange(prisma, unit.id, from, to),
    prisma.criticalAlertEvent.findMany({
      where: { unitUid: unit.externalId, occurredAt: { gte: from, lte: to } },
      orderBy: { occurredAt: "asc" },
      take: MAX_ALERTS_LISTED + 1
    })
  ]);

  const trips = tripsResult.trips;
  const totalKm = trips.reduce((sum, t) => sum + (t.distanceKm ?? 0), 0);
  const totalMinutes = trips.reduce((sum, t) => sum + t.durationMinutes, 0);

  /** Resumen por día (hora SV): todos los días del rango, aunque no
   * haya movimiento, para que se note cuándo la unidad no reportó. */
  const days = new Map<string, { trips: number; km: number; minutes: number; maxSpeed: number; alerts: number }>();

  for (let t = from.getTime(); t <= to.getTime(); t += 24 * 3600000) {
    days.set(localDayKey(new Date(t)), { trips: 0, km: 0, minutes: 0, maxSpeed: 0, alerts: 0 });
  }

  for (const trip of trips) {
    const day = days.get(localDayKey(new Date(trip.startTime)));
    if (!day) continue;
    day.trips++;
    day.km += trip.distanceKm ?? 0;
    day.minutes += trip.durationMinutes;
    for (const point of trip.points) {
      if (point.speed > day.maxSpeed) day.maxSpeed = point.speed;
    }
  }

  for (const alert of alerts) {
    const day = days.get(localDayKey(alert.occurredAt));
    if (day) day.alerts++;
  }

  const doc = new PDFDocument({
    size: "A4",
    margin: PAGE_MARGIN,
    info: { Title: `Reporte ${unit.name}`, Author: "DADA DADA Fleet" }
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // ---------- Encabezado ----------
  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLOR_PRIMARY).text("DADA DADA Fleet");
  doc.moveDown(0.2);
  doc.font("Helvetica-Bold").fontSize(18).fillColor(COLOR_TEXT).text("Reporte de vehículo");
  doc.moveDown(0.3);

  doc.font("Helvetica").fontSize(10).fillColor(COLOR_TEXT);
  doc.text(`Vehículo: ${unit.name}`);
  doc.text(`Placa: ${unit.plate || "—"}`);
  doc.text(`Compañía: ${unit.companyName || "—"}`);
  doc.text(`Período: ${formatDate(from)} al ${formatDate(to)} (hora de El Salvador)`);
  doc.fillColor(COLOR_MUTED).fontSize(8.5).text(`Generado: ${formatDateTime(new Date())}`);
  doc.moveDown(0.6);

  // ---------- Resumen ----------
  sectionTitle(doc, "Resumen");

  const summaryRows: string[][] = [
    ["Distancia recorrida (estimada)", formatKm(totalKm)],
    ["Viajes", String(trips.length)],
    ["Tiempo en movimiento", formatDuration(totalMinutes)],
    ["Velocidad máxima", `${Math.round(tripsResult.maxSpeed)} km/h`],
    ["Alertas en el período", String(alerts.length > MAX_ALERTS_LISTED ? `${MAX_ALERTS_LISTED}+` : alerts.length)],
    ["Posiciones registradas", String(tripsResult.positionsChecked)]
  ];

  drawTable(doc, ["Indicador", "Valor"], [260, 255], summaryRows);

  if (tripsResult.positionsChecked === 0) {
    doc.font("Helvetica-Oblique").fontSize(9).fillColor(COLOR_MUTED)
      .text("La unidad no tiene posiciones registradas en este período (no reportó o no hay historial local para esas fechas).");
    doc.moveDown(0.6);
  }

  // ---------- Por día ----------
  sectionTitle(doc, "Detalle por día");

  drawTable(
    doc,
    ["Fecha", "Viajes", "Distancia", "En movimiento", "Vel. máx.", "Alertas"],
    [95, 60, 90, 100, 80, 90],
    [...days.entries()].map(([key, d]) => [
      keyToDisplay(key),
      String(d.trips),
      formatKm(d.km),
      formatDuration(d.minutes),
      `${Math.round(d.maxSpeed)} km/h`,
      String(d.alerts)
    ])
  );

  // ---------- Viajes ----------
  sectionTitle(doc, `Viajes${trips.length > MAX_TRIPS_LISTED ? ` (primeros ${MAX_TRIPS_LISTED} de ${trips.length})` : ""}`);

  if (trips.length === 0) {
    doc.font("Helvetica").fontSize(9).fillColor(COLOR_MUTED).text("Sin viajes en el período.");
    doc.moveDown(0.6);
  } else {
    drawTable(
      doc,
      ["#", "Fecha", "Inicio", "Fin", "Duración", "Distancia", "Vel. máx."],
      [30, 80, 65, 65, 85, 90, 100],
      trips.slice(0, MAX_TRIPS_LISTED).map((trip, index) => {
        const start = new Date(trip.startTime);
        const end = new Date(trip.endTime);
        const maxSpeed = trip.points.reduce((m, p) => Math.max(m, p.speed), 0);
        return [
          String(index + 1),
          formatDate(start),
          formatTime(start),
          formatTime(end),
          formatDuration(trip.durationMinutes),
          formatKm(trip.distanceKm ?? 0),
          `${Math.round(maxSpeed)} km/h`
        ];
      })
    );
  }

  // ---------- Alertas ----------
  sectionTitle(doc, `Alertas${alerts.length > MAX_ALERTS_LISTED ? ` (primeras ${MAX_ALERTS_LISTED})` : ""}`);

  if (alerts.length === 0) {
    doc.font("Helvetica").fontSize(9).fillColor(COLOR_MUTED).text("Sin alertas registradas en el período.");
    doc.moveDown(0.6);
  } else {
    drawTable(
      doc,
      ["Fecha y hora", "Tipo", "Detalle"],
      [105, 150, 260],
      alerts.slice(0, MAX_ALERTS_LISTED).map((alert) => [
        formatDateTime(alert.occurredAt),
        alert.alertTypeName,
        (alert.description || "—").replace(/\s*\n\s*/g, " · ").slice(0, 160)
      ])
    );
  }

  doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(COLOR_MUTED).text(
    "Fuente: historial local de posiciones y alertas sincronizado desde 3Dtracking. " +
    "La distancia es una estimación a partir de las posiciones GPS (suma de tramos en movimiento).",
    PAGE_MARGIN
  );

  doc.end();

  const buffer = await done;

  const safeName = unit.name.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || unit.externalId;
  const fileName = `reporte_${safeName}_${localDayKey(from)}_${localDayKey(to)}.pdf`;

  const summary =
    `Reporte de ${unit.name} del ${formatDate(from)} al ${formatDate(to)}: ` +
    `${trips.length} viaje(s), ${formatKm(totalKm)}, ${alerts.length} alerta(s).`;

  return { buffer, fileName, summary };
}
