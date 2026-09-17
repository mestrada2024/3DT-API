import { useCallback, useEffect, useState } from "react";

import { useAuth } from "../auth/AuthContext";
import { apiRequest, ApiError } from "../api/client";

interface Unit {
  id: number;
  name: string;
  plate: string | null;
  status: string;
  companyName: string | null;
  batteryLevel: string | null;
  speed: string | null;
  lastPositionAt: string | null;
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

function isStale(value: string | null): boolean {
  if (!value) {
    return true;
  }

  const diffMs = Date.now() - new Date(value).getTime();
  return diffMs > 30 * 60 * 1000;
}

function statusClass(status: string): string {
  const normalized = status.toLowerCase();

  if (normalized.includes("activ")) {
    return "badge badge-online";
  }

  if (normalized.includes("inactiv") || normalized.includes("suspend")) {
    return "badge badge-offline";
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

export function Dashboard() {
  const { user, logout } = useAuth();

  const [units, setUnits] = useState<Unit[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadUnits = useCallback(
    async (targetPage: number, searchTerm: string, showSpinner: boolean) => {
      if (showSpinner) {
        setLoading(true);
      }

      setError(null);

      try {
        const params = new URLSearchParams({
          page: String(targetPage),
          limit: String(PAGE_SIZE)
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

  useEffect(() => {
    loadUnits(page, search, true);
  }, [page, search, loadUnits]);

  useEffect(() => {
    const timer = setInterval(() => {
      loadUnits(page, search, false);
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [page, search, loadUnits]);

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPage(1);
    loadUnits(1, search, true);
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-brand">DMS Fleet</div>

        <div className="app-header-right">
          <span className="app-user">{user?.username}</span>
          <button className="btn-secondary" onClick={logout}>
            Cerrar sesión
          </button>
        </div>
      </header>

      <main className="app-main">
        <div className="dashboard-toolbar">
          <h1>Unidades</h1>

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
                <th>Unidad</th>
                <th>Compañía</th>
                <th>Estado</th>
                <th>Hora de transmisión</th>
                <th>Batería</th>
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
                      {formatLastTransmission(unit.lastPositionAt)}
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
      </main>
    </div>
  );
}
