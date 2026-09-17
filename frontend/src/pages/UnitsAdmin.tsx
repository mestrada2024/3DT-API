import { useCallback, useEffect, useState } from "react";

import { AppHeader } from "../components/AppHeader";
import { SortableHeader, SortDirection } from "../components/SortableHeader";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import {
  assignTrackerToUnit,
  Company,
  createUnit,
  deleteUnit,
  listCompaniesLocal,
  listUnitsAdmin,
  Unit,
  unassignTrackerFromUnit,
  updateUnitPlate
} from "../api/admin";

const PAGE_SIZE = 20;

export function UnitsAdmin() {
  const { user } = useAuth();
  const canWrite = user?.role === "root" || user?.role === "admin";

  const [units, setUnits] = useState<Unit[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [companies, setCompanies] = useState<Company[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [companyUid, setCompanyUid] = useState("");

  const [editingPlateId, setEditingPlateId] = useState<number | null>(null);
  const [plateDraft, setPlateDraft] = useState("");

  const [assigningId, setAssigningId] = useState<number | null>(null);
  const [assignTrackerUid, setAssignTrackerUid] = useState("");

  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  const load = useCallback(
    async (targetPage: number, searchTerm: string, sortField: string, sortDirection: SortDirection) => {
      setLoading(true);
      setError(null);

      try {
        const response = await listUnitsAdmin({
          page: targetPage,
          limit: PAGE_SIZE,
          search: searchTerm.trim() || undefined,
          sortBy: sortField,
          sortDir: sortDirection
        });
        setUnits(response.data);
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

  useEffect(() => {
    listCompaniesLocal({ page: 1, limit: 100 })
      .then((response) => setCompanies(response.data))
      .catch(() => {
        // El selector de compañía queda vacío si falla; el resto de la
        // página sigue funcionando.
      });
  }, []);

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

    if (!name.trim() || !companyUid) {
      setFormError("Nombre y compañía son requeridos");
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      await createUnit({ name: name.trim(), companyUid });

      setName("");
      setCompanyUid("");
      setShowForm(false);
      setPage(1);
      setSearch("");
      load(1, "", sortBy, sortDir);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "No se pudo crear el vehículo");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(unit: Unit) {
    if (!confirm(`¿Eliminar el vehículo ${unit.name}? Esta acción no se puede deshacer.`)) {
      return;
    }

    try {
      await deleteUnit(unit.externalId);
      load(page, search, sortBy, sortDir);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "No se pudo eliminar el vehículo");
    }
  }

  async function handleSavePlate(unit: Unit) {
    try {
      await updateUnitPlate(unit.externalId, plateDraft.trim());
      setEditingPlateId(null);
      load(page, search, sortBy, sortDir);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "No se pudo actualizar la placa");
    }
  }

  async function handleAssignTracker(unit: Unit) {
    if (!assignTrackerUid.trim()) return;

    try {
      await assignTrackerToUnit(unit.externalId, assignTrackerUid.trim());
      setAssigningId(null);
      setAssignTrackerUid("");
      load(page, search, sortBy, sortDir);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "No se pudo asignar el GPS");
    }
  }

  async function handleUnassignTracker(unit: Unit) {
    if (!confirm(`¿Quitar el GPS del vehículo ${unit.name}?`)) {
      return;
    }

    try {
      await unassignTrackerFromUnit(unit.externalId);
      load(page, search, sortBy, sortDir);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "No se pudo quitar el GPS");
    }
  }

  return (
    <div className="app-shell">
      <AppHeader />

      <main className="app-main">
        <div className="dashboard-toolbar">
          <h1>Vehículos</h1>

          <div className="toolbar-actions">
            <form className="search-form" onSubmit={handleSearchSubmit}>
              <input
                type="text"
                placeholder="Buscar por nombre, placa o IMEI"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button type="submit" className="btn-secondary">Buscar</button>
            </form>

            {canWrite && (
              <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
                {showForm ? "Cancelar" : "+ Nuevo vehículo"}
              </button>
            )}
          </div>
        </div>

        {showForm && canWrite && (
          <form className="inline-panel" onSubmit={handleCreate}>
            <div className="inline-panel-grid">
              <label className="field">
                <span>Nombre *</span>
                <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </label>
              <label className="field">
                <span>Compañía *</span>
                <select value={companyUid} onChange={(e) => setCompanyUid(e.target.value)}>
                  <option value="">Seleccionar...</option>
                  {companies.map((c) => (
                    <option key={c.uid} value={c.uid}>{c.name || c.uid}</option>
                  ))}
                </select>
              </label>
            </div>

            {formError && <div className="form-error">{formError}</div>}

            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Guardando..." : "Guardar vehículo"}
            </button>
          </form>
        )}

        <div className="dashboard-meta">
          <span>{total} vehículos</span>
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <SortableHeader label="Vehículo" field="name" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Compañía" field="companyName" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Placa" field="plate" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <th>GPS</th>
                {canWrite && <th></th>}
              </tr>
            </thead>
            <tbody>
              {loading && units.length === 0 && (
                <tr><td colSpan={5} className="table-empty">Cargando vehículos...</td></tr>
              )}

              {!loading && units.length === 0 && !error && (
                <tr><td colSpan={5} className="table-empty">No se encontraron vehículos</td></tr>
              )}

              {units.map((unit) => (
                <tr key={unit.id}>
                  <td className="unit-name">{unit.name}</td>
                  <td>{unit.companyName || "—"}</td>
                  <td>
                    {editingPlateId === unit.id ? (
                      <div className="row-actions">
                        <input
                          className="inline-input"
                          value={plateDraft}
                          onChange={(e) => setPlateDraft(e.target.value)}
                          autoFocus
                        />
                        <button className="btn-link" onClick={() => handleSavePlate(unit)}>Guardar</button>
                        <button className="btn-link" onClick={() => setEditingPlateId(null)}>Cancelar</button>
                      </div>
                    ) : (
                      <div className="row-actions">
                        <span>{unit.plate || "—"}</span>
                        {canWrite && (
                          <button
                            className="btn-link"
                            onClick={() => { setEditingPlateId(unit.id); setPlateDraft(unit.plate || ""); }}
                          >
                            Editar
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    {unit.trackerUid ? (
                      <div className="row-actions">
                        <span title={unit.trackerUid || undefined}>{unit.trackerName || unit.trackerUid}</span>
                        {canWrite && (
                          <button className="btn-danger-text" onClick={() => handleUnassignTracker(unit)}>
                            Quitar
                          </button>
                        )}
                      </div>
                    ) : !canWrite ? (
                      <span>—</span>
                    ) : assigningId === unit.id ? (
                      <div className="row-actions">
                        <input
                          className="inline-input"
                          placeholder="UID del GPS"
                          value={assignTrackerUid}
                          onChange={(e) => setAssignTrackerUid(e.target.value)}
                          autoFocus
                        />
                        <button className="btn-link" onClick={() => handleAssignTracker(unit)}>Asignar</button>
                        <button className="btn-link" onClick={() => { setAssigningId(null); setAssignTrackerUid(""); }}>Cancelar</button>
                      </div>
                    ) : (
                      <button className="btn-link" onClick={() => { setAssigningId(unit.id); setAssignTrackerUid(""); }}>
                        Asignar GPS
                      </button>
                    )}
                  </td>
                  {canWrite && (
                    <td>
                      <button className="btn-danger-text" onClick={() => handleDelete(unit)}>
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
