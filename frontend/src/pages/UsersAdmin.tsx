import { useCallback, useEffect, useState } from "react";

import { AppHeader } from "../components/AppHeader";
import { ApiError } from "../api/client";
import {
  AdminUser,
  Company,
  createUser,
  deleteUser,
  listCompaniesLocal,
  listUsers,
  updateUser
} from "../api/admin";

const ROLES = [
  { value: "user", label: "Usuario (solo lectura)" },
  { value: "admin", label: "Admin (CRUD en sus empresas)" },
  { value: "root", label: "Root (acceso total)" }
];

export function UsersAdmin() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRole, setEditRole] = useState("user");
  const [editCompanies, setEditCompanies] = useState<string[]>([]);
  const [editPassword, setEditPassword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [usersResponse, companiesResponse] = await Promise.all([
        listUsers(),
        listCompaniesLocal({ page: 1, limit: 100 })
      ]);

      setUsers(usersResponse.data);
      setCompanies(companiesResponse.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function toggleCompany(list: string[], setList: (v: string[]) => void, uid: string) {
    if (list.includes(uid)) {
      setList(list.filter((c) => c !== uid));
    } else {
      setList([...list, uid]);
    }
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();

    if (!username.trim() || !password) {
      setFormError("Usuario y contraseña son requeridos");
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      await createUser({
        username: username.trim(),
        password,
        role,
        companyUids: selectedCompanies
      });

      setUsername("");
      setPassword("");
      setRole("user");
      setSelectedCompanies([]);
      setShowForm(false);
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "No se pudo crear el usuario");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(user: AdminUser) {
    setEditingId(user.id);
    setEditRole(user.role);
    setEditCompanies(user.companies.map((c) => c.uid));
    setEditPassword("");
  }

  async function handleSaveEdit(user: AdminUser) {
    try {
      await updateUser(user.id, {
        role: editRole,
        companyUids: editCompanies,
        password: editPassword.trim() || undefined
      });
      setEditingId(null);
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "No se pudo actualizar el usuario");
    }
  }

  async function handleToggleActive(user: AdminUser) {
    try {
      await updateUser(user.id, { active: !user.active });
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "No se pudo actualizar el usuario");
    }
  }

  async function handleDelete(user: AdminUser) {
    if (!confirm(`¿Eliminar el usuario ${user.username}? Esta acción no se puede deshacer.`)) {
      return;
    }

    try {
      await deleteUser(user.id);
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "No se pudo eliminar el usuario");
    }
  }

  return (
    <div className="app-shell">
      <AppHeader />

      <main className="app-main">
        <div className="dashboard-toolbar">
          <h1>Usuarios</h1>

          <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancelar" : "+ Nuevo usuario"}
          </button>
        </div>

        {showForm && (
          <form className="inline-panel" onSubmit={handleCreate}>
            <div className="inline-panel-grid">
              <label className="field">
                <span>Usuario *</span>
                <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
              </label>
              <label className="field">
                <span>Contraseña *</span>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              <label className="field">
                <span>Rol</span>
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </label>
            </div>

            {role !== "root" && (
              <div className="field">
                <span>Empresas asignadas</span>
                <div className="company-checklist">
                  {companies.map((c) => (
                    <label key={c.uid} className="company-check">
                      <input
                        type="checkbox"
                        checked={selectedCompanies.includes(c.uid)}
                        onChange={() => toggleCompany(selectedCompanies, setSelectedCompanies, c.uid)}
                      />
                      {c.name || c.uid}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {formError && <div className="form-error">{formError}</div>}

            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Guardando..." : "Guardar usuario"}
            </button>
          </form>
        )}

        {error && <div className="form-error">{error}</div>}

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Empresas</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && users.length === 0 && (
                <tr><td colSpan={5} className="table-empty">Cargando usuarios...</td></tr>
              )}

              {users.map((user) => (
                <tr key={user.id}>
                  <td className="unit-name">{user.username}</td>

                  {editingId === user.id ? (
                    <>
                      <td>
                        <select value={editRole} onChange={(e) => setEditRole(e.target.value)}>
                          {ROLES.map((r) => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {editRole !== "root" && (
                          <div className="company-checklist company-checklist-compact">
                            {companies.map((c) => (
                              <label key={c.uid} className="company-check">
                                <input
                                  type="checkbox"
                                  checked={editCompanies.includes(c.uid)}
                                  onChange={() => toggleCompany(editCompanies, setEditCompanies, c.uid)}
                                />
                                {c.name || c.uid}
                              </label>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        <input
                          className="inline-input"
                          type="password"
                          placeholder="Nueva contraseña (opcional)"
                          value={editPassword}
                          onChange={(e) => setEditPassword(e.target.value)}
                        />
                      </td>
                      <td>
                        <div className="row-actions">
                          <button className="btn-link" onClick={() => handleSaveEdit(user)}>Guardar</button>
                          <button className="btn-link" onClick={() => setEditingId(null)}>Cancelar</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{ROLES.find((r) => r.value === user.role)?.label || user.role}</td>
                      <td>
                        {user.role === "root"
                          ? "Todas"
                          : user.companies.map((c) => c.name).join(", ") || "—"}
                      </td>
                      <td>
                        <span className={user.active ? "badge badge-online" : "badge badge-offline"}>
                          {user.active ? "Activo" : "Inactivo"}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button className="btn-link" onClick={() => startEdit(user)}>Editar</button>
                          <button className="btn-link" onClick={() => handleToggleActive(user)}>
                            {user.active ? "Desactivar" : "Activar"}
                          </button>
                          <button className="btn-danger-text" onClick={() => handleDelete(user)}>
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
