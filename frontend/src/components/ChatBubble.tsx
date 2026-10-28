import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError } from "../api/client";
import { ChatTicket, createChatTicket, listChatTickets } from "../api/admin";
import { TicketThread } from "./TicketThread";

const RECENT_LIMIT = 5;

function statusBadgeClass(value: string): string {
  if (value === "resuelto" || value === "cerrado") return "badge badge-online";
  if (value === "abierto") return "badge badge-offline";
  return "badge badge-unknown";
}

/**
 * Burbuja flotante de chat interno — pedido explícito del usuario
 * 2026-10-26. Crear un ticket abre directamente su conversación,
 * donde el bot saluda y ofrece el menú de colas (ver
 * chat-bot.service.ts); los tickets recientes también se abren en la
 * misma conversación. Visible en cualquier pantalla para cualquier
 * rol autenticado — se monta una sola vez desde ProtectedRoute.
 */
export function ChatBubble() {
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [recentTickets, setRecentTickets] = useState<ChatTicket[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);

  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [activeTicket, setActiveTicket] = useState<ChatTicket | null>(null);

  async function loadRecent() {
    setLoadingRecent(true);
    setRecentError(null);

    try {
      const response = await listChatTickets({});
      setRecentTickets(response.data.slice(0, RECENT_LIMIT));
    } catch (err) {
      setRecentError(err instanceof ApiError ? err.message : "No se pudieron cargar los tickets");
    } finally {
      setLoadingRecent(false);
    }
  }

  useEffect(() => {
    if (open) {
      loadRecent();
    }
  }, [open]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();

    if (!subject.trim() || !description.trim()) {
      setCreateError("Asunto y descripción son requeridos");
      return;
    }

    setCreating(true);
    setCreateError(null);

    try {
      const response = await createChatTicket({ subject: subject.trim(), description: description.trim() });
      setSubject("");
      setDescription("");
      setActiveTicket(response.data);
      loadRecent();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "No se pudo crear el ticket");
    } finally {
      setCreating(false);
    }
  }

  function goToTickets() {
    setOpen(false);
    navigate("/tickets");
  }

  return (
    <>
      {open && (
        <div className="chat-bubble-panel">
          <div className="chat-bubble-panel-header">
            <strong>{activeTicket ? `#${activeTicket.id} ${activeTicket.subject}` : "Chat interno"}</strong>
            <button type="button" className="unit-panel-close" onClick={() => setOpen(false)} aria-label="Cerrar">
              ✕
            </button>
          </div>

          {activeTicket && (
            <>
              <TicketThread ticket={activeTicket} onTicketUpdated={setActiveTicket} />
              <button
                type="button"
                className="btn-link"
                onClick={() => {
                  setActiveTicket(null);
                  loadRecent();
                }}
              >
                ← Volver
              </button>
            </>
          )}

          {!activeTicket && (
          <>
          <form className="chat-bubble-form" onSubmit={handleCreate}>
            <label className="field">
              <span>Asunto</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="¿En qué te ayudamos?" />
            </label>

            <label className="field">
              <span>Descripción</span>
              <textarea
                className="template-textarea"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>

            {createError && <div className="form-error">{createError}</div>}

            <button type="submit" className="btn-primary" disabled={creating}>
              {creating ? "Enviando..." : "Iniciar ticket"}
            </button>
          </form>

          <div className="chat-bubble-recent">
            <div className="unit-panel-section-title">Tickets recientes</div>

            {loadingRecent && <div className="unit-panel-alerts-empty">Cargando...</div>}
            {recentError && <div className="form-error">{recentError}</div>}

            {!loadingRecent && !recentError && recentTickets.length === 0 && (
              <div className="unit-panel-alerts-empty">Sin tickets todavía</div>
            )}

            {!loadingRecent && recentTickets.length > 0 && (
              <ul className="unit-panel-alerts-list">
                {recentTickets.map((ticket) => (
                  <li key={ticket.id} className="row-clickable" onClick={() => setActiveTicket(ticket)}>
                    <span className={statusBadgeClass(ticket.status)} style={{ marginRight: 6 }}>
                      {ticket.status}
                    </span>
                    #{ticket.id} {ticket.subject}
                  </li>
                ))}
              </ul>
            )}

            <button type="button" className="btn-link" onClick={goToTickets}>
              Ver todos los tickets
            </button>
          </div>
          </>
          )}
        </div>
      )}

      <button
        type="button"
        className={open ? "chat-bubble-button chat-bubble-button-open" : "chat-bubble-button"}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Cerrar chat interno" : "Abrir chat interno"}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      </button>
    </>
  );
}
