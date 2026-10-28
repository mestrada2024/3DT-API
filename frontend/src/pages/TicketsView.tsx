import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { AppHeader } from "../components/AppHeader";
import { TicketThread } from "../components/TicketThread";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import {
  ChatQueue,
  ChatTicket,
  Company,
  QueueAgent,
  createChatTicket,
  getChatTicket,
  listChatQueues,
  listChatTickets,
  listCompaniesLocal,
  listQueueAgents,
  updateChatTicket
} from "../api/admin";

type ViewKey = "default" | "unclaimed" | "historico";

const STATUS_OPTIONS = [
  { value: "abierto", label: "Abierto" },
  { value: "en_progreso", label: "En progreso" },
  { value: "resuelto", label: "Resuelto" },
  { value: "cerrado", label: "Cerrado" }
];

const PRIORITY_OPTIONS = [
  { value: "baja", label: "Baja" },
  { value: "normal", label: "Normal" },
  { value: "alta", label: "Alta" },
  { value: "urgente", label: "Urgente" }
];

function statusLabel(value: string): string {
  return STATUS_OPTIONS.find((s) => s.value === value)?.label || value;
}

function priorityLabel(value: string): string {
  return PRIORITY_OPTIONS.find((p) => p.value === value)?.label || value;
}

function statusBadgeClass(value: string): string {
  if (value === "resuelto" || value === "cerrado") return "badge badge-online";
  if (value === "abierto") return "badge badge-offline";
  return "badge badge-unknown";
}

function priorityBadgeClass(value: string): string {
  if (value === "urgente" || value === "alta") return "badge badge-offline";
  if (value === "baja") return "badge badge-online";
  return "badge badge-unknown";
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("es-SV", {
    timeZone: "America/El_Salvador",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function TicketsView() {
  const { user } = useAuth();
  const role = user?.role;

  const isAgente = role === "user";
  const isSupervisor = role === "supervisor";
  const isAdminOrRoot = role === "root" || role === "admin";
  const canSeeQueueFilter = isAdminOrRoot || isSupervisor;
  const canManageQueues = role === "root";

  const [view, setView] = useState<ViewKey>("default");
  const [statusFilter, setStatusFilter] = useState("");
  const [queueFilter, setQueueFilter] = useState<number | "">("");

  const [tickets, setTickets] = useState<ChatTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [queues, setQueues] = useState<ChatQueue[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [queueId, setQueueId] = useState<number | "">("");
  const [companyUid, setCompanyUid] = useState("");
  const [requesterName, setRequesterName] = useState("");
  const [requesterPhone, setRequesterPhone] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);


  const [searchId, setSearchId] = useState("");

  const [selected, setSelected] = useState<ChatTicket | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [editStatus, setEditStatus] = useState("");
  const [editPriority, setEditPriority] = useState("");
  const [editQueueId, setEditQueueId] = useState<number | "">("");
  const [queueAgents, setQueueAgents] = useState<QueueAgent[]>([]);
  const [reassignToUserId, setReassignToUserId] = useState<number | "">("");

  const load = useCallback(
    async (targetView: ViewKey, status: string, queue: number | "") => {
      setLoading(true);
      setError(null);

      try {
        const response = await listChatTickets({
          status: status || undefined,
          queueId: queue === "" ? undefined : queue,
          view: targetView === "default" ? undefined : targetView
        });
        setTickets(response.data);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    load(view, statusFilter, queueFilter);
  }, [view, statusFilter, queueFilter, load]);

  useEffect(() => {
    listChatQueues()
      .then((res) => setQueues(res.data))
      .catch(() => {
        // Silencioso: el filtro/selector de colas simplemente queda vacío.
      });

    listCompaniesLocal({ page: 1, limit: 200 })
      .then((res) => setCompanies(res.data))
      .catch(() => {
        // Silencioso: el selector de empresa queda vacío, companyUid es opcional.
      });
  }, []);

  /**
   * /tickets?ticket=ID — abre ese ticket directo (lo usa la campana de
   * notificaciones). Se limpia el parámetro para que cerrar el panel
   * no lo vuelva a abrir.
   */
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const requested = parseInt(searchParams.get("ticket") || "", 10);
    if (isNaN(requested)) return;

    setSearchParams({}, { replace: true });

    getChatTicket(requested)
      .then((res) => openPanel(res.data))
      .catch((err) => {
        setSelected({ id: requested } as ChatTicket);
        setPanelError(err instanceof ApiError ? err.message : "No se pudo abrir el ticket");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function openPanel(ticket: ChatTicket) {
    setSelected(ticket);
    setPanelError(null);
    setEditStatus(ticket.status);
    setEditPriority(ticket.priority);
    setEditQueueId(ticket.queueId ?? "");
    setReassignToUserId("");
    setQueueAgents([]);

    if ((isAdminOrRoot || isSupervisor) && ticket.queueId) {
      listQueueAgents(ticket.queueId)
        .then((res) => setQueueAgents(res.data))
        .catch(() => {
          // Silencioso: si falla, el selector de reasignación queda vacío.
        });
    }
  }

  function closePanel() {
    setSelected(null);
    setPanelError(null);
  }

  async function handleSearchById(event: React.FormEvent) {
    event.preventDefault();
    const id = parseInt(searchId, 10);
    if (isNaN(id)) return;

    setPanelLoading(true);
    setPanelError(null);

    try {
      const response = await getChatTicket(id);
      openPanel(response.data);
    } catch (err) {
      setSelected({ id } as ChatTicket);
      setPanelError(err instanceof ApiError ? err.message : "No se pudo encontrar el ticket");
    } finally {
      setPanelLoading(false);
    }
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();

    if (!subject.trim() || !description.trim()) {
      setCreateError("Asunto y descripción son requeridos");
      return;
    }

    setCreating(true);
    setCreateError(null);

    try {
      await createChatTicket({
        subject: subject.trim(),
        description: description.trim(),
        priority,
        queueId: queueId === "" ? undefined : queueId,
        companyUid: companyUid || undefined,
        requesterName: requesterName.trim() || undefined,
        requesterPhone: requesterPhone.trim() || undefined
      });

      setSubject("");
      setDescription("");
      setPriority("normal");
      setQueueId("");
      setCompanyUid("");
      setRequesterName("");
      setRequesterPhone("");
      setShowCreateForm(false);
      load(view, statusFilter, queueFilter);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "No se pudo crear el ticket");
    } finally {
      setCreating(false);
    }
  }

  async function applyUpdate(body: Parameters<typeof updateChatTicket>[1]) {
    if (!selected) return;

    setActionLoading(true);
    setPanelError(null);

    try {
      const response = await updateChatTicket(selected.id, body);
      setSelected(response.data);
      load(view, statusFilter, queueFilter);
    } catch (err) {
      setPanelError(err instanceof ApiError ? err.message : "No se pudo actualizar el ticket");
    } finally {
      setActionLoading(false);
    }
  }

  function handleClaim() {
    applyUpdate({ claim: true });
  }

  function handleRelease() {
    applyUpdate({ release: true });
  }

  function handleUnassign() {
    applyUpdate({ assignedToUserId: null });
  }

  /**
   * "Reclamar para mí" para admin/supervisor/root — pedido explícito
   * del usuario 2026-10-26: "los supervisores y admin pueden asignar
   * y reclamar tickets". No es un flag nuevo en el backend: usa el
   * mismo campo assignedToUserId que ya acepta el PATCH para estos
   * roles, apuntado al propio usuario — la reasignación a otro
   * agente y "reclamar para mí" son la misma operación.
   */
  function handleClaimForSelf() {
    if (!user) return;
    applyUpdate({ assignedToUserId: user.id });
  }

  function handleReassign() {
    if (reassignToUserId === "") return;
    applyUpdate({ assignedToUserId: reassignToUserId });
  }

  function handleSaveEdits() {
    if (isAgente) {
      applyUpdate({ status: editStatus });
      return;
    }

    applyUpdate({
      status: editStatus,
      priority: editPriority,
      ...(isAdminOrRoot ? { queueId: editQueueId === "" ? null : editQueueId } : {})
    });
  }

  const viewTabs: { key: ViewKey; label: string }[] = isAgente
    ? [
        { key: "default", label: "Mis tickets" },
        { key: "unclaimed", label: "Sin reclamar" },
        { key: "historico", label: "Histórico" }
      ]
    : [
        { key: "default", label: role === "cliente" ? "Mis tickets" : "Todos" },
        { key: "historico", label: "Histórico" }
      ];

  const assignedToMe = selected?.assignedToUserId === user?.id;
  const isUnclaimed = selected ? selected.assignedToUserId === null : false;

  return (
    <div className="app-shell">
      <AppHeader />

      <main className="app-main">
        <div className="dashboard-toolbar">
          <h1>Chat interno — Tickets</h1>

          <div className="toolbar-actions">
            <form className="search-form" onSubmit={handleSearchById}>
              <input
                type="text"
                placeholder="Buscar ticket por ID"
                value={searchId}
                onChange={(e) => setSearchId(e.target.value)}
                style={{ width: 160 }}
              />
              <button type="submit" className="btn-secondary">Buscar</button>
            </form>

            <button className="btn-primary" onClick={() => setShowCreateForm((v) => !v)}>
              {showCreateForm ? "Cancelar" : "+ Nuevo ticket"}
            </button>
          </div>
        </div>

        {showCreateForm && (
          <form className="inline-panel" onSubmit={handleCreate}>
            <div className="inline-panel-grid">
              <label className="field">
                <span>Asunto *</span>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} autoFocus />
              </label>

              <label className="field">
                <span>Prioridad</span>
                <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Cola</span>
                <select value={queueId} onChange={(e) => setQueueId(e.target.value ? Number(e.target.value) : "")}>
                  <option value="">Sin cola</option>
                  {queues.map((q) => (
                    <option key={q.id} value={q.id}>{q.name}</option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Empresa</span>
                <select value={companyUid} onChange={(e) => setCompanyUid(e.target.value)}>
                  <option value="">Sin empresa</option>
                  {companies.map((c) => (
                    <option key={c.uid} value={c.uid}>{c.name || c.uid}</option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Nombre de contacto</span>
                <input value={requesterName} onChange={(e) => setRequesterName(e.target.value)} />
              </label>

              <label className="field">
                <span>Teléfono de contacto</span>
                <input value={requesterPhone} onChange={(e) => setRequesterPhone(e.target.value)} />
              </label>
            </div>

            <label className="field">
              <span>Descripción *</span>
              <textarea
                className="template-textarea"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>

            {createError && <div className="form-error">{createError}</div>}

            <button type="submit" className="btn-primary" disabled={creating}>
              {creating ? "Guardando..." : "Crear ticket"}
            </button>
          </form>
        )}

        {canManageQueues && (
          <div className="inline-panel">
            <div className="row-actions" style={{ justifyContent: "space-between" }}>
              <strong>Colas de soporte</strong>
              <Link to="/admin/colas" className="btn-link">
                Administrar colas y menú del bot
              </Link>
            </div>

            <div className="row-actions">
              {queues.length === 0 && <span className="unit-panel-alerts-empty">Sin colas creadas</span>}
              {queues.map((q) => (
                <span key={q.id} className="badge badge-unknown">{q.name}</span>
              ))}
            </div>
          </div>
        )}

        <div className="submodule-tabs">
          {viewTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={view === tab.key ? "submodule-tab submodule-tab-active" : "submodule-tab"}
              onClick={() => setView(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="toolbar-actions" style={{ marginBottom: 12 }}>
          <label className="field" style={{ margin: 0 }}>
            <span>Estado</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Todos</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>

          {canSeeQueueFilter && (
            <label className="field" style={{ margin: 0 }}>
              <span>Cola</span>
              <select
                value={queueFilter}
                onChange={(e) => setQueueFilter(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">Todas</option>
                {queues.map((q) => (
                  <option key={q.id} value={q.id}>{q.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Asunto</th>
                <th className="hide-sm">Prioridad</th>
                <th>Estado</th>
                <th className="hide-sm">Cola</th>
                <th>Asignado a</th>
                <th className="hide-sm">Creado</th>
              </tr>
            </thead>
            <tbody>
              {loading && tickets.length === 0 && (
                <tr><td colSpan={7} className="table-empty">Cargando tickets...</td></tr>
              )}

              {!loading && tickets.length === 0 && !error && (
                <tr><td colSpan={7} className="table-empty">No hay tickets en esta vista</td></tr>
              )}

              {tickets.map((ticket) => (
                <tr key={ticket.id} className="row-clickable" onClick={() => openPanel(ticket)}>
                  <td>#{ticket.id}</td>
                  <td>{ticket.subject}</td>
                  <td className="hide-sm"><span className={priorityBadgeClass(ticket.priority)}>{priorityLabel(ticket.priority)}</span></td>
                  <td><span className={statusBadgeClass(ticket.status)}>{statusLabel(ticket.status)}</span></td>
                  <td className="hide-sm">{queues.find((q) => q.id === ticket.queueId)?.name || "—"}</td>
                  <td>{ticket.assignedToUsername || "Sin reclamar"}</td>
                  <td className="hide-sm">{formatDateTime(ticket.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {selected && (
        <div className="side-panel-overlay" onClick={closePanel}>
          <div className="side-panel" onClick={(e) => e.stopPropagation()}>
            <div className="unit-panel-header">
              <div>
                <div className="unit-panel-title">Ticket #{selected.id}</div>
                {selected.subject && <div className="unit-panel-subtitle">{selected.subject}</div>}
              </div>
              <button type="button" className="unit-panel-close" onClick={closePanel} aria-label="Cerrar">✕</button>
            </div>

            {panelLoading && <div className="unit-panel-alerts-empty">Cargando...</div>}
            {panelError && <div className="form-error">{panelError}</div>}

            {!panelError && selected.subject && (
              <>
                <div className="unit-panel-row">
                  <span className={priorityBadgeClass(selected.priority)}>{priorityLabel(selected.priority)}</span>
                  <span className={statusBadgeClass(selected.status)}>{statusLabel(selected.status)}</span>
                </div>

                <div className="unit-panel-section">
                  <div className="unit-panel-section-title">Descripción</div>
                  <div>{selected.description}</div>
                </div>

                <div className="unit-panel-facts">
                  <div>
                    <span className="unit-panel-fact-label">Cola</span>
                    <span>{queues.find((q) => q.id === selected.queueId)?.name || "Sin cola"}</span>
                  </div>
                  <div>
                    <span className="unit-panel-fact-label">Asignado a</span>
                    <span>{selected.assignedToUsername || "Sin reclamar"}</span>
                  </div>
                  <div>
                    <span className="unit-panel-fact-label">Creado por</span>
                    <span>{selected.createdByUsername || "—"}</span>
                  </div>
                  <div>
                    <span className="unit-panel-fact-label">Contacto</span>
                    <span>{selected.requesterName || selected.requesterPhone || "—"}</span>
                  </div>
                  <div>
                    <span className="unit-panel-fact-label">Creado</span>
                    <span>{formatDateTime(selected.createdAt)}</span>
                  </div>
                  <div>
                    <span className="unit-panel-fact-label">Actualizado</span>
                    <span>{formatDateTime(selected.updatedAt)}</span>
                  </div>
                </div>

                <div className="unit-panel-section">
                  <div className="unit-panel-section-title">Conversación</div>
                  <TicketThread
                    ticket={selected}
                    onTicketUpdated={(updated) => {
                      setSelected(updated);
                      setTickets((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
                    }}
                  />
                </div>

                {role === "cliente" && (
                  <div className="unit-panel-alerts-empty">
                    Como cliente podés ver el ticket, pero solo un agente puede editarlo.
                  </div>
                )}

                {isAgente && isUnclaimed && (
                  <div className="unit-panel-section">
                    <div className="unit-panel-section-title">Responder</div>
                    <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                    <div className="unit-panel-actions">
                      <button type="button" className="btn-primary" disabled={actionLoading} onClick={handleSaveEdits}>
                        Responder (te lo reclama automáticamente)
                      </button>
                      <button type="button" className="btn-secondary" disabled={actionLoading} onClick={handleClaim}>
                        Solo reclamar
                      </button>
                    </div>
                  </div>
                )}

                {isAgente && !isUnclaimed && assignedToMe && (
                  <div className="unit-panel-section">
                    <div className="unit-panel-section-title">Cambiar estado</div>
                    <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                    <div className="unit-panel-actions">
                      <button type="button" className="btn-primary" disabled={actionLoading} onClick={handleSaveEdits}>
                        Guardar estado
                      </button>
                      <button type="button" className="btn-secondary" disabled={actionLoading} onClick={handleRelease}>
                        Liberar ticket
                      </button>
                    </div>
                  </div>
                )}

                {isAgente && !isUnclaimed && !assignedToMe && (
                  <div className="unit-panel-alerts-empty">
                    Asignado a otro agente — solo podés consultar el historial.
                  </div>
                )}

                {(isAdminOrRoot || isSupervisor) && (
                  <div className="unit-panel-section">
                    <div className="unit-panel-section-title">Editar</div>

                    <label className="field">
                      <span>Estado</span>
                      <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                    </label>

                    <label className="field">
                      <span>Prioridad</span>
                      <select value={editPriority} onChange={(e) => setEditPriority(e.target.value)}>
                        {PRIORITY_OPTIONS.map((p) => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    </label>

                    {isAdminOrRoot && (
                      <label className="field">
                        <span>Cola</span>
                        <select
                          value={editQueueId}
                          onChange={(e) => setEditQueueId(e.target.value ? Number(e.target.value) : "")}
                        >
                          <option value="">Sin cola</option>
                          {queues.map((q) => (
                            <option key={q.id} value={q.id}>{q.name}</option>
                          ))}
                        </select>
                      </label>
                    )}

                    <div className="unit-panel-actions">
                      <button type="button" className="btn-primary" disabled={actionLoading} onClick={handleSaveEdits}>
                        Guardar cambios
                      </button>
                      {selected.assignedToUserId !== user?.id && (
                        <button type="button" className="btn-secondary" disabled={actionLoading} onClick={handleClaimForSelf}>
                          Reclamar para mí
                        </button>
                      )}
                      {selected.assignedToUserId !== null && (
                        <button type="button" className="btn-secondary" disabled={actionLoading} onClick={handleUnassign}>
                          Quitar asignación
                        </button>
                      )}
                    </div>

                    {selected.queueId === null ? (
                      <div className="unit-panel-alerts-empty">
                        Sin cola asignada — no se puede reasignar a un agente específico.
                      </div>
                    ) : (
                      <>
                        <label className="field">
                          <span>Reasignar a</span>
                          <select
                            value={reassignToUserId}
                            onChange={(e) => setReassignToUserId(e.target.value ? Number(e.target.value) : "")}
                          >
                            <option value="">Elegí un agente de la cola</option>
                            {queueAgents.map((agent) => (
                              <option key={agent.id} value={agent.id}>{agent.username}</option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={actionLoading || reassignToUserId === ""}
                          onClick={handleReassign}
                        >
                          Reasignar
                        </button>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
