import { useCallback, useEffect, useState } from "react";

import { AppHeader } from "../components/AppHeader";
import { ApiError } from "../api/client";
import {
  ChatBotConfig,
  ChatQueue,
  ChatQueueDestination,
  ChatQueueKind,
  createChatQueue,
  getChatBotConfig,
  listChatQueues,
  saveChatBotConfig,
  updateChatQueue
} from "../api/admin";

interface QueueRow {
  queue: ChatQueue;
  depth: number;
}

function byMenuOrder(a: ChatQueue, b: ChatQueue): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

/**
 * Árbol del menú: principales arriba, cada secundaria debajo de su
 * padre. Las que quedaron sin padre válido se listan al final para
 * que no desaparezcan de la pantalla.
 */
function buildRows(queues: ChatQueue[]): QueueRow[] {
  const rows: QueueRow[] = [];
  const seen = new Set<number>();

  function addChildren(parentId: number, depth: number) {
    queues
      .filter((q) => q.parentId === parentId)
      .sort(byMenuOrder)
      .forEach((q) => {
        if (seen.has(q.id)) return;
        seen.add(q.id);
        rows.push({ queue: q, depth });
        addChildren(q.id, depth + 1);
      });
  }

  queues
    .filter((q) => q.kind === "principal")
    .sort(byMenuOrder)
    .forEach((q) => {
      seen.add(q.id);
      rows.push({ queue: q, depth: 0 });
      addChildren(q.id, 1);
    });

  queues.filter((q) => !seen.has(q.id)).forEach((q) => rows.push({ queue: q, depth: 0 }));

  return rows;
}

function optionLabel(queue: ChatQueue): string {
  return queue.description?.trim() || queue.name;
}

/**
 * Colas de soporte = opciones del menú del chatbot (pedido del
 * usuario 2026-10-26). Solo root — mismo permiso que el backend
 * (requireRoot en chat-queues.ts).
 */
export function QueuesAdmin() {
  const [queues, setQueues] = useState<ChatQueue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<ChatQueueKind>("principal");
  const [parentId, setParentId] = useState<number | "">("");
  const [destination, setDestination] = useState<ChatQueueDestination>("agentes");
  const [sortOrder, setSortOrder] = useState("0");
  const [active, setActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [botConfig, setBotConfig] = useState<ChatBotConfig>({ greeting: "", invalidOption: "", transferMessage: "" });
  const [botError, setBotError] = useState<string | null>(null);
  const [botSaved, setBotSaved] = useState(false);
  const [savingBot, setSavingBot] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await listChatQueues();
      setQueues(response.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();

    getChatBotConfig()
      .then((res) => {
        if (res.data) setBotConfig(res.data);
      })
      .catch((err) => setBotError(err instanceof ApiError ? err.message : "No se pudo cargar la configuración del bot"));
  }, [load]);

  function resetForm() {
    setEditingId(null);
    setName("");
    setDescription("");
    setKind("principal");
    setParentId("");
    setDestination("agentes");
    setSortOrder("0");
    setActive(true);
    setFormError(null);
  }

  function openCreate() {
    resetForm();
    setShowForm(true);
  }

  function openEdit(queue: ChatQueue) {
    setEditingId(queue.id);
    setName(queue.name);
    setDescription(queue.description || "");
    setKind(queue.kind);
    setParentId(queue.parentId ?? "");
    setDestination(queue.destination);
    setSortOrder(String(queue.sortOrder));
    setActive(queue.active);
    setFormError(null);
    setShowForm(true);
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();

    if (!name.trim()) {
      setFormError("El nombre es requerido");
      return;
    }

    if (kind === "secundaria" && parentId === "") {
      setFormError("Elegí la cola padre donde va a aparecer esta opción");
      return;
    }

    setSaving(true);
    setFormError(null);

    const body = {
      name: name.trim(),
      description: description.trim() || null,
      kind,
      destination,
      parentId: kind === "secundaria" && parentId !== "" ? parentId : null,
      sortOrder: parseInt(sortOrder, 10) || 0,
      active
    };

    try {
      if (editingId === null) {
        await createChatQueue(body);
      } else {
        await updateChatQueue(editingId, body);
      }
      setShowForm(false);
      resetForm();
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "No se pudo guardar la cola");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveBot(event: React.FormEvent) {
    event.preventDefault();
    setSavingBot(true);
    setBotError(null);
    setBotSaved(false);

    try {
      const response = await saveChatBotConfig(botConfig);
      setBotConfig(response.data);
      setBotSaved(true);
    } catch (err) {
      setBotError(err instanceof ApiError ? err.message : "No se pudo guardar la configuración del bot");
    } finally {
      setSavingBot(false);
    }
  }

  const rows = buildRows(queues);
  const parentCandidates = queues.filter((q) => q.destination === "cola" && q.id !== editingId);
  const mainMenu = queues.filter((q) => q.kind === "principal" && q.active).sort(byMenuOrder);
  const nameOf = (id: number | null) => queues.find((q) => q.id === id)?.name || "—";

  return (
    <div className="app-shell">
      <AppHeader />

      <main className="app-main">
        <div className="dashboard-toolbar">
          <h1>Chat interno — Colas y menú del bot</h1>

          <div className="toolbar-actions">
            <button className="btn-primary" onClick={() => (showForm ? setShowForm(false) : openCreate())}>
              {showForm ? "Cancelar" : "+ Nueva cola"}
            </button>
          </div>
        </div>

        {showForm && (
          <form className="inline-panel" onSubmit={handleSave}>
            <strong>{editingId === null ? "Nueva cola" : `Editar cola #${editingId}`}</strong>

            <div className="inline-panel-grid">
              <label className="field">
                <span>Nombre *</span>
                <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </label>

              <label className="field">
                <span>Tipo</span>
                <select value={kind} onChange={(e) => setKind(e.target.value as ChatQueueKind)}>
                  <option value="principal">Principal (menú inicial)</option>
                  <option value="secundaria">Secundaria (dentro de otra cola)</option>
                </select>
              </label>

              {kind === "secundaria" && (
                <label className="field">
                  <span>Aparece dentro de *</span>
                  <select value={parentId} onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : "")}>
                    <option value="">Elegí la cola padre</option>
                    {parentCandidates.map((q) => (
                      <option key={q.id} value={q.id}>{q.name}</option>
                    ))}
                  </select>
                </label>
              )}

              <label className="field">
                <span>Destino al elegirla</span>
                <select value={destination} onChange={(e) => setDestination(e.target.value as ChatQueueDestination)}>
                  <option value="agentes">Agentes (el ticket queda en esta cola)</option>
                  <option value="cola">Cola (muestra sus opciones secundarias)</option>
                </select>
              </label>

              <label className="field">
                <span>Orden</span>
                <input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
              </label>

              <label className="field">
                <span>Activa</span>
                <select value={active ? "1" : "0"} onChange={(e) => setActive(e.target.value === "1")}>
                  <option value="1">Sí</option>
                  <option value="0">No (no aparece en el menú)</option>
                </select>
              </label>
            </div>

            <label className="field">
              <span>Descripción — texto que muestra el bot como opción (vacío = nombre)</span>
              <textarea
                className="template-textarea"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>

            {kind === "secundaria" && parentCandidates.length === 0 && (
              <div className="unit-panel-alerts-empty">
                No hay colas con destino "Cola" — creá o editá primero una cola con ese destino para colgar secundarias.
              </div>
            )}

            {formError && <div className="form-error">{formError}</div>}

            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Guardando..." : editingId === null ? "Crear cola" : "Guardar cambios"}
            </button>
          </form>
        )}

        {error && <div className="form-error">{error}</div>}

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Cola</th>
                <th className="hide-sm">Descripción (texto del bot)</th>
                <th className="hide-sm">Tipo</th>
                <th>Destino</th>
                <th className="hide-sm">Orden</th>
                <th>Activa</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && queues.length === 0 && (
                <tr><td colSpan={7} className="table-empty">Cargando colas...</td></tr>
              )}

              {!loading && queues.length === 0 && !error && (
                <tr><td colSpan={7} className="table-empty">No hay colas todavía</td></tr>
              )}

              {rows.map(({ queue, depth }) => (
                <tr key={queue.id}>
                  <td style={{ paddingLeft: 12 + depth * 20 }}>
                    {depth > 0 && "↳ "}
                    {queue.name}
                  </td>
                  <td className="hide-sm">{queue.description || "—"}</td>
                  <td className="hide-sm">
                    {queue.kind === "principal" ? "Principal" : `Secundaria de ${nameOf(queue.parentId)}`}
                  </td>
                  <td>{queue.destination === "cola" ? "Cola (submenú)" : "Agentes"}</td>
                  <td className="hide-sm">{queue.sortOrder}</td>
                  <td>
                    <span className={queue.active ? "badge badge-online" : "badge badge-unknown"}>
                      {queue.active ? "Sí" : "No"}
                    </span>
                  </td>
                  <td>
                    <button type="button" className="btn-link" onClick={() => openEdit(queue)}>Editar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form className="inline-panel" onSubmit={handleSaveBot} style={{ marginTop: 16 }}>
          <strong>Mensajes del bot</strong>

          <label className="field">
            <span>Saludo (primer mensaje del ticket, antes del menú)</span>
            <textarea
              className="template-textarea"
              rows={2}
              value={botConfig.greeting}
              onChange={(e) => setBotConfig({ ...botConfig, greeting: e.target.value })}
            />
          </label>

          <label className="field">
            <span>Opción no reconocida</span>
            <textarea
              className="template-textarea"
              rows={2}
              value={botConfig.invalidOption}
              onChange={(e) => setBotConfig({ ...botConfig, invalidOption: e.target.value })}
            />
          </label>

          <label className="field">
            <span>
              Al elegir una opción con destino Agentes (el ticket pasa a la cola recién cuando el cliente escribe
              "agente") — {"{cola}"} se reemplaza por el nombre de la cola
            </span>
            <textarea
              className="template-textarea"
              rows={2}
              value={botConfig.transferMessage}
              onChange={(e) => setBotConfig({ ...botConfig, transferMessage: e.target.value })}
            />
          </label>

          {botError && <div className="form-error">{botError}</div>}
          {botSaved && <div className="unit-panel-alerts-empty">Guardado.</div>}

          <button type="submit" className="btn-primary" disabled={savingBot}>
            {savingBot ? "Guardando..." : "Guardar mensajes"}
          </button>

          <div className="unit-panel-section-title">Vista previa del primer mensaje</div>
          <div className="ticket-msg ticket-msg-bot">
            <div className="ticket-msg-body">
              {mainMenu.length === 0
                ? "Sin colas principales activas — el bot no saluda y el ticket queda sin cola."
                : `${botConfig.greeting}\n\n${mainMenu.map((q, i) => `${i + 1}. ${optionLabel(q)}`).join("\n")}`}
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}
