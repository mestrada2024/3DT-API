import { useCallback, useEffect, useState } from "react";

import { AppHeader } from "../components/AppHeader";
import { SortableHeader, SortDirection } from "../components/SortableHeader";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { createSim, deleteSim, listSims, Sim } from "../api/admin";

const PAGE_SIZE = 20;

function syncBadgeClass(status: string): string {
  if (status === "synced") return "badge badge-online";
  if (status === "error") return "badge badge-offline";
  return "badge badge-unknown";
}

export function SimsAdmin() {
  const { user } = useAuth();
  const canWrite = user?.role === "root" || user?.role === "admin";

  const [sims, setSims] = useState<Sim[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sortBy, setSortBy] = useState("iccid");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [iccid, setIccid] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [pin, setPin] = useState("");
  const [puk, setPuk] = useState("");

  const load = useCallback(
    async (targetPage: number, searchTerm: string, sortField: string, sortDirection: SortDirection) => {
      setLoading(true);
      setError(null);

      try {
        const response = await listSims({
          page: targetPage,
          limit: PAGE_SIZE,
          search: searchTerm.trim() || undefined,
          sortBy: sortField,
          sortDir: sortDirection
        });
        setSims(response.data);
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

    if (!iccid.trim()) {
      setFormError("El ICCID es requerido");
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      await createSim({
        iccid: iccid.trim(),
        phoneNumber: phoneNumber.trim() || undefined,
        pin: pin.trim() || undefined,
        puk: puk.trim() || undefined
      });

      setIccid("");
      setPhoneNumber("");
      setPin("");
      setPuk("");
      setShowForm(false);
      load(1, "", sortBy, sortDir);
      setPage(1);
      setSearch("");
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "No se pudo crear el SIM");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(sim: Sim) {
    if (!confirm(`¿Eliminar el SIM ${sim.iccid}? Esta acción no se puede deshacer.`)) {
      return;
    }

    try {
      await deleteSim(sim.iccid);
      load(page, search, sortBy, sortDir);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "No se pudo eliminar el SIM");
    }
  }

  return (
    <div className="app-shell">
      <AppHeader />

      <main className="app-main">
        <div className="dashboard-toolbar">
          <h1>SIMs</h1>

          <div className="toolbar-actions">
            <form className="search-form" onSubmit={handleSearchSubmit}>
              <input
                type="text"
                placeholder="Buscar por ICCID, teléfono o tracker"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button type="submit" className="btn-secondary">Buscar</button>
            </form>

            {canWrite && (
              <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
                {showForm ? "Cancelar" : "+ Nuevo SIM"}
              </button>
            )}
          </div>
        </div>

        {showForm && (
          <form className="inline-panel" onSubmit={handleCreate}>
            <div className="inline-panel-grid">
              <label className="field">
                <span>ICCID *</span>
                <input value={iccid} onChange={(e) => setIccid(e.target.value)} autoFocus />
              </label>
              <label className="field">
                <span>Teléfono</span>
                <input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
              </label>
              <label className="field">
                <span>PIN</span>
                <input value={pin} onChange={(e) => setPin(e.target.value)} />
              </label>
              <label className="field">
                <span>PUK</span>
                <input value={puk} onChange={(e) => setPuk(e.target.value)} />
              </label>
            </div>

            {formError && <div className="form-error">{formError}</div>}

            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Guardando..." : "Guardar SIM"}
            </button>
          </form>
        )}

        <div className="dashboard-meta">
          <span>{total} SIMs</span>
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <SortableHeader label="ICCID" field="iccid" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Teléfono" field="phoneNumber" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <th>Tracker asignado</th>
                <SortableHeader label="Sincronización" field="syncStatus" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                {canWrite && <th></th>}
              </tr>
            </thead>
            <tbody>
              {loading && sims.length === 0 && (
                <tr><td colSpan={5} className="table-empty">Cargando SIMs...</td></tr>
              )}

              {!loading && sims.length === 0 && !error && (
                <tr><td colSpan={5} className="table-empty">No se encontraron SIMs</td></tr>
              )}

              {sims.map((sim) => (
                <tr key={sim.id}>
                  <td className="unit-name">{sim.iccid}</td>
                  <td>{sim.phoneNumber || "—"}</td>
                  <td>{sim.trackerName || sim.trackerUid || "—"}</td>
                  <td>
                    <span className={syncBadgeClass(sim.syncStatus)} title={sim.syncError || undefined}>
                      {sim.syncStatus}
                    </span>
                  </td>
                  {canWrite && (
                    <td>
                      <button className="btn-danger-text" onClick={() => handleDelete(sim)}>
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
