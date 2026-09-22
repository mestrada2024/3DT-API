import { useEffect, useState } from "react";

import { AppHeader } from "../components/AppHeader";
import { ApiError } from "../api/client";
import {
  Company,
  Unit,
  DriverEventTypeOption,
  listCompaniesLocal,
  listUnitsAdmin,
  listDriverEventTypes,
  getDriverEventsReport,
  DriverEventsReport as DriverEventsReportData
} from "../api/admin";

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function toDatetimeLocalValue(dateStr: string, timeStr: string): string {
  return `${dateStr}T${timeStr}`;
}

function formatEventTime(iso: string): string {
  const date = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  return date.toLocaleString("es-SV", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function mapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

export function DriverEventsReport() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyUid, setCompanyUid] = useState("");

  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedUnitIds, setSelectedUnitIds] = useState<Set<string>>(new Set());

  const [eventTypes, setEventTypes] = useState<DriverEventTypeOption[]>([]);
  const [selectedEventTypes, setSelectedEventTypes] = useState<Set<string>>(new Set());

  const [fromDate, setFromDate] = useState(todayStr());
  const [fromTime, setFromTime] = useState("00:00");
  const [toDate, setToDate] = useState(todayStr());
  const [toTime, setToTime] = useState("23:59");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<DriverEventsReportData | null>(null);

  useEffect(() => {
    listCompaniesLocal({ page: 1, limit: 200 })
      .then((res) => setCompanies(res.data))
      .catch(() => setCompanies([]));

    listDriverEventTypes()
      .then((res) => setEventTypes(res.data))
      .catch(() => setEventTypes([]));
  }, []);

  useEffect(() => {
    setSelectedUnitIds(new Set());

    if (!companyUid) {
      setUnits([]);
      return;
    }

    listUnitsAdmin({ page: 1, limit: 500 })
      .then((res) => setUnits(res.data.filter((u) => u.companyUid === companyUid)))
      .catch(() => setUnits([]));
  }, [companyUid]);

  function toggleUnit(externalId: string) {
    setSelectedUnitIds((prev) => {
      const next = new Set(prev);
      if (next.has(externalId)) {
        next.delete(externalId);
      } else {
        next.add(externalId);
      }
      return next;
    });
  }

  function toggleAllUnits() {
    setSelectedUnitIds((prev) =>
      prev.size === units.length ? new Set() : new Set(units.map((u) => u.externalId))
    );
  }

  function toggleEventType(code: string) {
    setSelectedEventTypes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  }

  function toggleAllEventTypes() {
    setSelectedEventTypes((prev) =>
      prev.size === eventTypes.length ? new Set() : new Set(eventTypes.map((t) => t.code))
    );
  }

  async function handleGenerate(event: React.FormEvent) {
    event.preventDefault();

    if (!companyUid) {
      setError("Selecciona una empresa");
      return;
    }

    if (selectedUnitIds.size === 0) {
      setError("Selecciona al menos una unidad (o usa \"Seleccionar todas\")");
      return;
    }

    if (selectedEventTypes.size === 0) {
      setError("Selecciona al menos un tipo de evento (o usa \"Seleccionar todos\")");
      return;
    }

    setLoading(true);
    setError(null);
    setReport(null);

    try {
      const from = new Date(toDatetimeLocalValue(fromDate, fromTime) + ":00Z").toISOString();
      const to = new Date(toDatetimeLocalValue(toDate, toTime) + ":59Z").toISOString();

      const response = await getDriverEventsReport({
        companyUid,
        from,
        to,
        units: [...selectedUnitIds],
        eventTypes: [...selectedEventTypes]
      });

      setReport(response.data);

    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo generar el reporte");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <AppHeader />

      <main className="app-main">
        <div className="dashboard-toolbar">
          <h1>Reporte de eventos de conductor</h1>
        </div>

        <p className="submodule-help">
          Datos reales de 3Dtracking (no una aproximación) — frenado brusco,
          aceleración brusca, giro brusco, exceso de velocidad y accidente.
          Para rangos de varios días puede tardar varios minutos, ya que se
          consulta directamente contra su API.
        </p>

        <form className="inline-panel" onSubmit={handleGenerate}>
          <div className="inline-panel-grid">
            <label className="field">
              <span>Empresa</span>
              <select value={companyUid} onChange={(e) => setCompanyUid(e.target.value)}>
                <option value="">Selecciona una empresa</option>
                {companies.map((c) => (
                  <option key={c.uid} value={c.uid}>{c.name || c.uid}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Fecha inicio</span>
              <input type="date" value={fromDate} max={todayStr()} onChange={(e) => setFromDate(e.target.value)} />
            </label>

            <label className="field">
              <span>Hora inicio</span>
              <input type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} />
            </label>

            <label className="field">
              <span>Fecha fin</span>
              <input type="date" value={toDate} max={todayStr()} onChange={(e) => setToDate(e.target.value)} />
            </label>

            <label className="field">
              <span>Hora fin</span>
              <input type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} />
            </label>
          </div>

          <div className="field">
            <span>Tipos de evento</span>
            <div className="company-checklist">
              <label className="company-check">
                <input
                  type="checkbox"
                  checked={eventTypes.length > 0 && selectedEventTypes.size === eventTypes.length}
                  onChange={toggleAllEventTypes}
                />
                <strong>Seleccionar todos</strong>
              </label>
              {eventTypes.map((t) => (
                <label key={t.code} className="company-check">
                  <input
                    type="checkbox"
                    checked={selectedEventTypes.has(t.code)}
                    onChange={() => toggleEventType(t.code)}
                  />
                  {t.name}
                </label>
              ))}
            </div>
          </div>

          {companyUid && (
            <div className="field">
              <span>Unidades</span>
              <div className="company-checklist">
                {units.length === 0 && <span className="dashboard-meta">Esta empresa no tiene unidades</span>}
                {units.length > 0 && (
                  <label className="company-check">
                    <input
                      type="checkbox"
                      checked={selectedUnitIds.size === units.length}
                      onChange={toggleAllUnits}
                    />
                    <strong>Seleccionar todas</strong>
                  </label>
                )}
                {units.map((u) => (
                  <label key={u.externalId} className="company-check">
                    <input
                      type="checkbox"
                      checked={selectedUnitIds.has(u.externalId)}
                      onChange={() => toggleUnit(u.externalId)}
                    />
                    {u.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && <div className="form-error">{error}</div>}

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Generando... (puede tardar varios minutos)" : "Generar reporte"}
          </button>
        </form>

        {report && (
          <>
            <div className="dashboard-meta">
              {report.events.length} eventos encontrados — {report.positionsChecked} posiciones revisadas en {report.pagesProcessed} páginas.
              {report.truncated && (
                <strong style={{ color: "var(--color-danger, #b91c1c)" }}>
                  {" "}⚠ Reporte incompleto — se alcanzó el límite de consulta antes de cubrir todo el rango pedido.
                </strong>
              )}
            </div>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Fecha/hora (local)</th>
                    <th>Tipo</th>
                    <th>Unidad</th>
                    <th>Velocidad</th>
                    <th>Rumbo</th>
                    <th>Ignición</th>
                    <th>Odómetro</th>
                    <th>Conductor</th>
                    <th>Dirección</th>
                    <th>Descripción</th>
                  </tr>
                </thead>
                <tbody>
                  {report.events.length === 0 && (
                    <tr>
                      <td colSpan={10} className="table-empty">Sin eventos en el rango seleccionado</td>
                    </tr>
                  )}

                  {report.events.map((ev, index) => (
                    <tr key={index}>
                      <td>{formatEventTime(ev.occurredAtUtc)}</td>
                      <td>{ev.alertTypeName}</td>
                      <td className="unit-name">{ev.unitName || ev.unitUid}</td>
                      <td>{ev.speed} {ev.speedMeasure || ""}</td>
                      <td>{ev.heading}°</td>
                      <td>{ev.ignition || "—"}</td>
                      <td>{ev.odometer !== null ? ev.odometer : "—"}</td>
                      <td>{ev.driverName || "—"}</td>
                      <td>
                        <a
                          href={mapsLink(ev.latitude, ev.longitude)}
                          target="_blank"
                          rel="noreferrer"
                          className="link-cell"
                        >
                          {ev.address || `${ev.latitude}, ${ev.longitude}`}
                        </a>
                      </td>
                      <td>{ev.description || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
