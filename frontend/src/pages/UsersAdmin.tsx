import { useCallback, useEffect, useState } from "react";

import { AppHeader } from "../components/AppHeader";
import { ApiError } from "../api/client";
import {
  AdminUser,
  ChatQueue,
  Company,
  createUser,
  deleteUser,
  listChatQueues,
  listCompaniesLocal,
  listUsers,
  updateUser
} from "../api/admin";

const ROLES = [
  { value: "cliente", label: "Cliente" },
  { value: "user", label: "Agente" },
  { value: "supervisor", label: "Supervisor" },
  { value: "admin", label: "Administrador" },
  { value: "root", label: "Root (acceso total)" }
];

/** Mismo criterio que WHATSAPP_REQUIRED_ROLES en users.ts: el número
 * de WhatsApp es obligatorio solo para el rol cliente — es la forma
 * en que un mensaje entrante se vincula a su cuenta. */
function whatsappRequired(role: string): boolean {
  return role === "cliente";
}

/** Agente y supervisor son los roles que interactúan con colas de
 * tickets — root/admin ven todo sin necesidad de cola, cliente no
 * reclama tickets. */
function usesQueues(role: string): boolean {
  return role === "user" || role === "supervisor";
}

export function UsersAdmin() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [queues, setQueues] = useState<ChatQueue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [whatsapp, setWhatsapp] = useState("");
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [selectedQueues, setSelectedQueues] = useState<number[]>([]);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRole, setEditRole] = useState("user");
  const [editWhatsapp, setEditWhatsapp] = useState("");
  const [editCompanies, setEditCompanies] = useState<string[]>([]);
  const [editQueues, setEditQueues] = useState<number[]>([]);
  const [editPassword, setEditPassword] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [usersResponse, companiesResponse, queuesResponse] = await Promise.all([
        listUsers(),
        listCompaniesLocal({ page: 1, limit: 100 }),
        listChatQueues()
      ]);

      setUsers(usersResponse.data);
      setCompanies(companiesResponse.data);
      setQueues(queuesResponse.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function toggleInList<T>(list: T[], setList: (v: T[]) => void, value: T) {
    if (list.includes(value)) {
      setList(list.filter((v) => v !== value));
    } else {
      setList([...list, value]);
    }
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();

    if (!username.trim() || !password) {
      setFormError("Usuario y contraseña son requeridos");
      return;
    }

    if (whatsappRequired(role) && !whatsapp.trim()) {
      setFormError("El campo WhatsApp es obligatorio para el rol Cliente");
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      await createUser({
        username: username.trim(),
        password,
        role,
        whatsapp: whatsapp.trim() || undefined,
        companyUids: selectedCompanies,
        queueIds: selectedQueues
      });

      setUsername("");
      setPassword("");
      setRole("user");
      setWhatsapp("");
      setSelectedCompanies([]);
      setSelectedQueues([]);
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
    setEditWhatsapp(user.whatsapp || "");
    setEditCompanies(user.companies.map((c) => c.uid));
    setEditQueues(user.queues.map((q) => q.id));
    setEditError(null);
  }

  async function handleSaveEdit(user: AdminUser) {
    if (whatsappRequired(editRole) && !editWhatsapp.trim()) {
      setEditError("El campo WhatsApp es obligatorio para el rol Cliente");
      return;
    }

    setEditError(null);

    try {
      await updateUser(user.id, {
        role: editRole,
        whatsapp: editWhatsapp.trim() || undefined,
        companyUids: editCompanies,
        queueIds: editQueues,
        password: editPassword.trim() || undefined
      });
      setEditingId(null);
      load();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "No se pudo actualizar el usuario");
    }
  }

  async function handleToggleActive(user: AdminUser) {
    setActionError(null);

    try {
      await updateUser(user.id, { active: !user.active });
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "No se pudo actualizar el usuario");
    }
  }

  /**
   * Confirmación dentro de la página en vez de window.confirm() —
   * bug real encontrado 2026-10-26: en algunos navegadores los
   * diálogos nativos (confirm/alert) quedan bloqueados para el sitio
   * (configuración del navegador o una extensión), y el botón
   * Eliminar simplemente no hacía nada porque confirm() devolvía
   * false sin mostrar nada. Editar/Activar nunca usaron confirm() y
   * por eso nunca mostraron el problema.
   */
  async function handleDelete(user: AdminUser) {
    setActionError(null);

    try {
      await deleteUser(user.id);
      setConfirmDeleteId(null);
      load();
    } catch (err) {
      setConfirmDeleteId(null);
      setActionError(err instanceof ApiError ? err.message : "No se pudo eliminar el usuario");
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
              <label className="field">
                <span>WhatsApp{whatsappRequired(role) ? " *" : ""}</span>
                <input
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  placeholder="50377XXXXXX"
                />
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
                        onChange={() => toggleInList(selectedCompanies, setSelectedCompanies, c.uid)}
                      />
                      {c.name || c.uid}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {usesQueues(role) && (
              <div className="field">
                <span>Colas de soporte</span>
                <div className="company-checklist">
                  {queues.length === 0 && <span className="unit-panel-alerts-empty">Sin colas creadas todavía</span>}
                  {queues.map((q) => (
                    <label key={q.id} className="company-check">
                      <input
                        type="checkbox"
                        checked={selectedQueues.includes(q.id)}
                        onChange={() => toggleInList(selectedQueues, setSelectedQueues, q.id)}
                      />
                      {q.name}
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
        {actionError && <div className="form-error">{actionError}</div>}

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Rol</th>
                <th>WhatsApp</th>
                <th>Empresas</th>
                <th>Colas</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && users.length === 0 && (
                <tr><td colSpan={7} className="table-empty">Cargando usuarios...</td></tr>
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
                        <input
                          className="inline-input"
                          value={editWhatsapp}
                          onChange={(e) => setEditWhatsapp(e.target.value)}
                          placeholder="50377XXXXXX"
                        />
                      </td>
                      <td>
                        {editRole !== "root" && (
                          <div className="company-checklist company-checklist-compact">
                            {companies.map((c) => (
                              <label key={c.uid} className="company-check">
                                <input
                                  type="checkbox"
                                  checked={editCompanies.includes(c.uid)}
                                  onChange={() => toggleInList(editCompanies, setEditCompanies, c.uid)}
                                />
                                {c.name || c.uid}
                              </label>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        {usesQueues(editRole) && (
                          <div className="company-checklist company-checklist-compact">
                            {queues.map((q) => (
                              <label key={q.id} className="company-check">
                                <input
                                  type="checkbox"
                                  checked={editQueues.includes(q.id)}
                                  onChange={() => toggleInList(editQueues, setEditQueues, q.id)}
                                />
                                {q.name}
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
                        {editError && <div className="form-error">{editError}</div>}
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{ROLES.find((r) => r.value === user.role)?.label || user.role}</td>
                      <td>{user.whatsapp || "—"}</td>
                      <td>
                        {user.role === "root"
                          ? "Todas"
                          : user.companies.map((c) => c.name).join(", ") || "—"}
                      </td>
                      <td>{user.queues.map((q) => q.name).join(", ") || "—"}</td>
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
                          {confirmDeleteId === user.id ? (
                            <>
                              <span>¿Confirmás?</span>
                              <button className="btn-danger-text" onClick={() => handleDelete(user)}>
                                Sí, eliminar
                              </button>
                              <button className="btn-link" onClick={() => setConfirmDeleteId(null)}>
                                Cancelar
                              </button>
                            </>
                          ) : (
                            <button className="btn-danger-text" onClick={() => setConfirmDeleteId(user.id)}>
                              Eliminar
                            </button>
                          )}
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
