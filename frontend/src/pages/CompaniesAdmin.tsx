import { useCallback, useEffect, useState } from "react";

import { AppHeader } from "../components/AppHeader";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Company, listCompaniesLocal, syncCompanies } from "../api/admin";

export function CompaniesAdmin() {
  const { user } = useAuth();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const load = useCallback(async (searchTerm: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await listCompaniesLocal({ page: 1, limit: 100, search: searchTerm.trim() || undefined });
      setCompanies(response.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(search);
  }, [search, load]);

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault();
    load(search);
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMessage(null);

    try {
      await syncCompanies();
      setSyncMessage("Sincronizado correctamente");
      load(search);
    } catch (err) {
      setSyncMessage(err instanceof ApiError ? err.message : "No se pudo sincronizar");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="app-shell">
      <AppHeader />

      <main className="app-main">
        <div className="dashboard-toolbar">
          <h1>Empresas</h1>

          <div className="toolbar-actions">
            <form className="search-form" onSubmit={handleSearchSubmit}>
              <input
                type="text"
                placeholder="Buscar por nombre o país"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button type="submit" className="btn-secondary">Buscar</button>
            </form>

            {user?.role === "root" && (
              <button className="btn-primary" onClick={handleSync} disabled={syncing}>
                {syncing ? "Sincronizando..." : "Sincronizar con 3Dtracking"}
              </button>
            )}
          </div>
        </div>

        {syncMessage && <div className="dashboard-meta">{syncMessage}</div>}

        <div className="dashboard-meta">
          <span>{companies.length} empresas</span>
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>UID</th>
                <th>País</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {loading && companies.length === 0 && (
                <tr><td colSpan={4} className="table-empty">Cargando empresas...</td></tr>
              )}

              {!loading && companies.length === 0 && !error && (
                <tr><td colSpan={4} className="table-empty">No se encontraron empresas</td></tr>
              )}

              {companies.map((company) => (
                <tr key={company.uid}>
                  <td className="unit-name">{company.name || "—"}</td>
                  <td>{company.uid}</td>
                  <td>{company.country || "—"}</td>
                  <td>{company.status || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
