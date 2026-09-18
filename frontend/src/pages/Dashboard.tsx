import { useCallback, useEffect, useState } from "react";

import { AppHeader } from "../components/AppHeader";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { SortableHeader, SortDirection } from "../components/SortableHeader";
import { useAuth } from "../auth/AuthContext";
import { apiRequest, ApiError } from "../api/client";
import {
  DashboardSummary,
  getDashboardSummary,
  TopCompanyItem,
  TopUnitItem
} from "../api/admin";

interface Unit {
  id: number;
  externalId: string;
  name: string;
  plate: string | null;
  status: string;
  companyName: string | null;
  batteryLevel: string | null;
  speed: string | null;
  lastPositionAt: string | null;
  latitude: string | null;
  longitude: string | null;
}

interface UnitsResponse {
  success: boolean;
  data: Unit[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

const REFRESH_INTERVAL_MS = 30000;
const PAGE_SIZE = 20;

function formatLastTransmission(value: string | null): string {
  if (!value) {
    return "Sin datos";
  }

  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) {
    return "Hace instantes";
  }

  if (diffMinutes < 60) {
    return `Hace ${diffMinutes} min`;
  }

  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours < 24) {
    return `Hace ${diffHours} h`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `Hace ${diffDays} d`;
}

function openTripsWindow(unit: { externalId: string }, date: string) {
  const url = `/trips/${encodeURIComponent(unit.externalId)}?date=${encodeURIComponent(date)}`;
  window.open(url, `trips-${unit.externalId}-${date}`, "width=1000,height=650,noopener,noreferrer");
}

function isStale(value: string | null): boolean {
  if (!value) {
    return true;
  }

  const diffMs = Date.now() - new Date(value).getTime();
  return diffMs > 30 * 60 * 1000;
}

function statusClass(status: string): string {
  const normalized = status.toLowerCase();

  /**
   * "inactiv"/"suspend" van primero a propósito: "inactivo" contiene
   * "activ" como substring, así que revisar "activ" primero
   * clasificaba mal 137 unidades reales (Inactivo) como si
   * estuvieran activas (bug real encontrado con datos reales).
   */
  if (normalized.includes("inactiv") || normalized.includes("suspend")) {
    return "badge badge-offline";
  }

  if (normalized.includes("activ")) {
    return "badge badge-online";
  }

  return "badge badge-unknown";
}

function batteryClass(level: number | null): string {
  if (level === null) {
    return "battery battery-unknown";
  }

  if (level <= 20) {
    return "battery battery-low";
  }

  if (level <= 50) {
    return "battery battery-mid";
  }

  return "battery battery-high";
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} h ${rest} min` : `${hours} h`;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat-tile">
      <div className="stat-tile-value">{value}</div>
      <div className="stat-tile-label">{label}</div>
    </div>
  );
}

function TopUnitsList({ items, unit }: { items: TopUnitItem[]; unit: "time" | "count" }) {
  if (items.length === 0) {
    return <div className="table-empty">Sin datos para el período seleccionado</div>;
  }

  return (
    <ol className="top-list">
      {items.map((item, index) => (
        <li key={item.unitId || item.externalId} className="top-list-item">
          <span className="top-list-rank">{index + 1}</span>
          <div className="top-list-info">
            <div className="unit-name">{item.name}</div>
            {item.companyName && <div className="unit-plate">{item.companyName}</div>}
          </div>
          <span className="top-list-value">
            {unit === "time" ? formatMinutes(item.value) : item.value}
          </span>
        </li>
      ))}
    </ol>
  );
}

function TopCompaniesList({ items }: { items: TopCompanyItem[] }) {
  if (items.length === 0) {
    return <div className="table-empty">Sin datos</div>;
  }

  return (
    <ol className="top-list">
      {items.map((item, index) => (
        <li key={item.companyUid} className="top-list-item">
          <span className="top-list-rank">{index + 1}</span>
          <div className="top-list-info">
            <div className="unit-name">{item.companyName}</div>
          </div>
          <span className="top-list-value">{item.count}</span>
        </li>
      ))}
    </ol>
  );
}

export function Dashboard() {
  const { logout } = useAuth();

  const [units, setUnits] = useState<Unit[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  const [date, setDate] = useState(todayStr());
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const loadUnits = useCallback(
    async (
      targetPage: number,
      searchTerm: string,
      sortField: string,
      sortDirection: SortDirection,
      showSpinner: boolean
    ) => {
      if (showSpinner) {
        setLoading(true);
      }

      setError(null);

      try {
        const params = new URLSearchParams({
          page: String(targetPage),
          limit: String(PAGE_SIZE),
          sortBy: sortField,
          sortDir: sortDirection
        });

        if (searchTerm.trim()) {
          params.set("search", searchTerm.trim());
        }

        const response = await apiRequest<UnitsResponse>(
          `/api/v1/units?${params.toString()}`
        );

        setUnits(response.data);
        setTotalPages(response.pagination.pages || 1);
        setTotal(response.pagination.total);
        setLastUpdated(new Date());
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          logout();
          return;
        }

        setError(
          err instanceof ApiError ? err.message : "No se pudo conectar con el servidor"
        );
      } finally {
        setLoading(false);
      }
    },
    [logout]
  );

  const loadSummary = useCallback(async (targetDate: string) => {
    setSummaryLoading(true);
    setSummaryError(null);

    try {
      const response = await getDashboardSummary(targetDate);
      setSummary(response.data);
    } catch (err) {
      setSummaryError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUnits(page, search, sortBy, sortDir, true);
  }, [page, search, sortBy, sortDir, loadUnits]);

  useEffect(() => {
    const timer = setInterval(() => {
      loadUnits(page, search, sortBy, sortDir, false);
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [page, search, sortBy, sortDir, loadUnits]);

  useEffect(() => {
    loadSummary(date);
  }, [date, loadSummary]);

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPage(1);
    loadUnits(1, search, sortBy, sortDir, true);
  }

  function handleSort(field: string) {
    if (field === sortBy) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDir("asc");
    }
    setPage(1);
  }

  return (
    <div className="app-shell">
      <AppHeader />

      <main className="app-main">
        <div className="dashboard-toolbar">
          <h1>Dashboard</h1>

          <label className="field field-inline">
            <span>Fecha</span>
            <input
              type="date"
              value={date}
              max={todayStr()}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>

        {summaryError && <div className="form-error">{summaryError}</div>}

        <CollapsibleSection title="Resumen de unidades" storageKey="kpis">
          {summaryLoading && !summary ? (
            <div className="table-empty">Cargando...</div>
          ) : (
            <div className="stat-tile-grid">
              <StatTile label="Total de unidades" value={summary?.counts.totalUnits ?? 0} />
              <StatTile label="Activas" value={summary?.counts.active ?? 0} />
              <StatTile label="Inactivas" value={summary?.counts.inactive ?? 0} />
              <StatTile label="Transmitiendo" value={summary?.counts.transmitting ?? 0} />
              <StatTile label="Sin transmitir +1 día" value={summary?.counts.notTransmittingOver1Day ?? 0} />
              <StatTile label="Total de empresas" value={summary?.counts.totalCompanies ?? 0} />
            </div>
          )}
        </CollapsibleSection>

        <div className="top-grid">
          <CollapsibleSection title="Top 5 empresas con más unidades transmitiendo" storageKey="top-companies">
            <TopCompaniesList items={summary?.topCompaniesByTransmitting ?? []} />
          </CollapsibleSection>

          <CollapsibleSection title="Top 5 unidades con más tiempo en viaje" storageKey="top-trip">
            <TopUnitsList items={summary?.topUnitsByTripTime ?? []} unit="time" />
          </CollapsibleSection>

          <CollapsibleSection title="Top 5 unidades con más tiempo en ralentí" storageKey="top-idle">
            <TopUnitsList items={summary?.topUnitsByIdleTime ?? []} unit="time" />
          </CollapsibleSection>

          <CollapsibleSection title="Top 5 unidades transmitiendo apagadas" storageKey="top-off">
            <TopUnitsList items={summary?.topUnitsByTransmittingOff ?? []} unit="count" />
          </CollapsibleSection>

          <CollapsibleSection title="Top 5 unidades con más alarmas" storageKey="top-alarms">
            <TopUnitsList items={summary?.topUnitsByAlarms ?? []} unit="count" />
          </CollapsibleSection>
        </div>

        <CollapsibleSection title="Listado de unidades" storageKey="units-table">
          <div className="dashboard-toolbar">
            <form className="search-form" onSubmit={handleSearchSubmit}>
              <input
                type="text"
                placeholder="Buscar por nombre, placa o IMEI"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button type="submit" className="btn-secondary">
                Buscar
              </button>
            </form>
          </div>

          <div className="dashboard-meta">
            <span>{total} unidades</span>
            {lastUpdated && (
              <span className="dashboard-updated">
                Actualizado {lastUpdated.toLocaleTimeString("es-SV")}
              </span>
            )}
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <SortableHeader label="Unidad" field="name" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Compañía" field="companyName" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Estado" field="status" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Hora de transmisión" field="lastPositionAt" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Batería" field="batteryLevel" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                </tr>
              </thead>
              <tbody>
                {loading && units.length === 0 && (
                  <tr>
                    <td colSpan={5} className="table-empty">
                      Cargando unidades...
                    </td>
                  </tr>
                )}

                {!loading && units.length === 0 && !error && (
                  <tr>
                    <td colSpan={5} className="table-empty">
                      No se encontraron unidades
                    </td>
                  </tr>
                )}

                {units.map((unit) => {
                  const battery =
                    unit.batteryLevel !== null ? parseFloat(unit.batteryLevel) : null;

                  return (
                    <tr key={unit.id}>
                      <td>
                        <div className="unit-name">{unit.name}</div>
                        {unit.plate && <div className="unit-plate">{unit.plate}</div>}
                      </td>
                      <td>{unit.companyName || "—"}</td>
                      <td>
                        <span className={statusClass(unit.status)}>{unit.status}</span>
                      </td>
                      <td className={isStale(unit.lastPositionAt) ? "stale" : ""}>
                        {unit.lastPositionAt ? (
                          <button
                            type="button"
                            className="link-cell"
                            onClick={() => openTripsWindow(unit, date)}
                            title={`Ver viajes del ${date} en el mapa`}
                          >
                            {formatLastTransmission(unit.lastPositionAt)}
                          </button>
                        ) : (
                          formatLastTransmission(unit.lastPositionAt)
                        )}
                      </td>
                      <td>
                        {battery !== null ? (
                          <span className={batteryClass(battery)}>{battery}%</span>
                        ) : (
                          <span className="battery battery-unknown">Sin datos</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button
              className="btn-secondary"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </button>
            <span>
              Página {page} de {totalPages}
            </span>
            <button
              className="btn-secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Siguiente
            </button>
          </div>
        </CollapsibleSection>
      </main>
    </div>
  );
}
