import { useCallback, useEffect, useState } from "react";

import { AppHeader } from "../components/AppHeader";
import { SortableHeader, SortDirection } from "../components/SortableHeader";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import {
  assignSimToTracker,
  createTracker,
  deleteTracker,
  listTrackers,
  listUnassignedSims,
  Sim,
  Tracker,
  unassignSimFromTracker
} from "../api/admin";

const PAGE_SIZE = 20;

function syncBadgeClass(status: string): string {
  if (status === "synced") return "badge badge-online";
  if (status === "error") return "badge badge-offline";
  return "badge badge-unknown";
}

export function TrackersAdmin() {
  const { user } = useAuth();
  const canWrite = user?.role === "root" || user?.role === "admin";

  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [imei, setImei] = useState("");
  const [unitModelName, setUnitModelName] = useState("");

  const [assigningId, setAssigningId] = useState<number | null>(null);
  const [assignIccid, setAssignIccid] = useState("");
  const [unassignedSims, setUnassignedSims] = useState<Sim[]>([]);
  const [loadingUnassigned, setLoadingUnassigned] = useState(false);

  const load = useCallback(
    async (targetPage: number, searchTerm: string, sortField: string, sortDirection: SortDirection) => {
      setLoading(true);
      setError(null);

      try {
        const response = await listTrackers({
          page: targetPage,
          limit: PAGE_SIZE,
          search: searchTerm.trim() || undefined,
          sortBy: sortField,
          sortDir: sortDirection
        });
        setTrackers(response.data);
        setTotalPages(response.pagination.pages || 1);
        setTotal(response.pagination.total);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    load(page, search, sortBy, sortDir);
  }, [page, search, sortBy, sortDir, load]);

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPage(1);
    load(1, search, sortBy, sortDir);
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

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();

    if (!imei.trim()) {
      setFormError("El IMEI es requerido");
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      await createTracker({ imei: imei.trim(), unitModelName: unitModelName.trim() || undefined });

      setImei("");
      setUnitModelName("");
      setShowForm(false);
      setPage(1);
      setSearch("");
      load(1, "", sortBy, sortDir);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "No se pudo crear el tracker");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(tracker: Tracker) {
    const identifier = tracker.uid || tracker.imei;
    if (!identifier) return;

    if (!confirm(`¿Eliminar el tracker ${tracker.name || identifier}? Esta acción no se puede deshacer.`)) {
      return;
    }

    try {
      await deleteTracker(identifier);
      load(page, search, sortBy, sortDir);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "No se pudo eliminar el tracker");
    }
  }

  async function handleStartAssign(tracker: Tracker) {
    setAssigningId(tracker.id);
    setAssignIccid("");
    setLoadingUnassigned(true);

    try {
      const response = await listUnassignedSims();
      setUnassignedSims(response.data);
    } catch {
      setUnassignedSims([]);
    } finally {
      setLoadingUnassigned(false);
    }
  }

  async function handleAssignSim(tracker: Tracker) {
    const identifier = tracker.uid || tracker.imei;
    if (!identifier || !assignIccid) return;

    try {
      await assignSimToTracker(identifier, assignIccid);
      setAssigningId(null);
      setAssignIccid("");
      load(page, search, sortBy, sortDir);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "No se pudo asignar el SIM");
    }
  }

  async function handleUnassignSim(tracker: Tracker) {
    const identifier = tracker.uid || tracker.imei;
    if (!identifier) return;

    if (!confirm(`¿Quitar el SIM del tracker ${tracker.name || identifier}?`)) {
      return;
    }

    try {
      await unassignSimFromTracker(identifier);
      load(page, search, sortBy, sortDir);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "No se pudo quitar el SIM");
    }
  }

  return (
    <div className="app-shell">
      <AppHeader />

      <main className="app-main">
        <div className="dashboard-toolbar">
          <h1>GPS (Trackers)</h1>

          <div className="toolbar-actions">
            <form className="search-form" onSubmit={handleSearchSubmit}>
              <input
                type="text"
                placeholder="Buscar por UID, nombre o IMEI"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button type="submit" className="btn-secondary">Buscar</button>
            </form>

            {canWrite && (
              <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
                {showForm ? "Cancelar" : "+ Nuevo tracker"}
              </button>
            )}
          </div>
        </div>

        {showForm && canWrite && (
          <form className="inline-panel" onSubmit={handleCreate}>
            <div className="inline-panel-grid">
              <label className="field">
                <span>IMEI *</span>
                <input value={imei} onChange={(e) => setImei(e.target.value)} autoFocus />
              </label>
              <label className="field">
                <span>Modelo de unidad (opcional)</span>
                <input
                  value={unitModelName}
                  onChange={(e) => setUnitModelName(e.target.value)}
                  placeholder="Aplica plantilla de configuración si existe"
                />
              </label>
            </div>

            {formError && <div className="form-error">{formError}</div>}

            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Guardando..." : "Guardar tracker"}
            </button>
          </form>
        )}

        <div className="dashboard-meta">
          <span>{total} trackers</span>
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <SortableHeader label="Tracker" field="name" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="IMEI" field="imei" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Modelo" field="unitModelName" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <th>SIM</th>
                <SortableHeader label="Sincronización" field="syncStatus" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                {canWrite && <th></th>}
              </tr>
            </thead>
            <tbody>
              {loading && trackers.length === 0 && (
                <tr><td colSpan={6} className="table-empty">Cargando trackers...</td></tr>
              )}

              {!loading && trackers.length === 0 && !error && (
                <tr><td colSpan={6} className="table-empty">No se encontraron trackers</td></tr>
              )}

              {trackers.map((tracker) => (
                <tr key={tracker.id}>
                  <td>
                    <div className="unit-name">{tracker.name || tracker.uid || "—"}</div>
                    <div className="unit-plate">{tracker.uid}</div>
                  </td>
                  <td>{tracker.imei || "—"}</td>
                  <td>{tracker.unitModelName || "—"}</td>
                  <td>
                    {tracker.simUid ? (
                      <div className="row-actions">
                        <span>{tracker.simPhoneNumber || tracker.simUid}</span>
                        {canWrite && (
                          <button className="btn-danger-text" onClick={() => handleUnassignSim(tracker)}>
                            Quitar
                          </button>
                        )}
                      </div>
                    ) : !canWrite ? (
                      <span>—</span>
                    ) : assigningId === tracker.id ? (
                      <div className="row-actions">
                        <select
                          className="inline-input"
                          value={assignIccid}
                          onChange={(e) => setAssignIccid(e.target.value)}
                          autoFocus
                        >
                          <option value="">
                            {loadingUnassigned ? "Cargando SIMs..." : "Seleccionar SIM..."}
                          </option>
                          {unassignedSims.map((sim) => (
                            <option key={sim.id} value={sim.iccid}>
                              {sim.phoneNumber || sim.iccid}
                            </option>
                          ))}
                        </select>
                        <button className="btn-link" onClick={() => handleAssignSim(tracker)} disabled={!assignIccid}>
                          Asignar
                        </button>
                        <button className="btn-link" onClick={() => { setAssigningId(null); setAssignIccid(""); }}>
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button className="btn-link" onClick={() => handleStartAssign(tracker)}>
                        Asignar SIM
                      </button>
                    )}
                  </td>
                  <td>
                    <span className={syncBadgeClass(tracker.syncStatus)}>{tracker.syncStatus}</span>
                  </td>
                  {canWrite && (
                    <td>
                      <button className="btn-danger-text" onClick={() => handleDelete(tracker)}>
                        Eliminar
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="pagination">
          <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Anterior
          </button>
          <span>Página {page} de {totalPages}</span>
          <button className="btn-secondary" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            Siguiente
          </button>
        </div>
      </main>
    </div>
  );
}
