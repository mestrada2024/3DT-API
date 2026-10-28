import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import {
  ChatAttachmentInfo,
  ChatMessage,
  ChatTicket,
  downloadChatAttachment,
  listChatMessages,
  sendChatMessage
} from "../api/admin";

const POLL_INTERVAL_MS = 10000;

function senderLabel(message: ChatMessage): string {
  if (message.senderType === "bot") return "Bot";
  return message.senderUsername || (message.senderType === "cliente" ? "Cliente" : "Agente");
}

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;

/** Los enlaces del bot (Google Maps) quedan tocables en el teléfono. */
function renderBody(body: string) {
  return body.split(URL_PATTERN).map((part, index) =>
    index % 2 === 1 ? (
      <a key={index} href={part} target="_blank" rel="noopener noreferrer">
        {part}
      </a>
    ) : (
      part
    )
  );
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return date.toLocaleString("es", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * Hilo de mensajes de un ticket — usado por la burbuja de chat y por
 * el panel lateral de /tickets. Mientras el bot está en el menú
 * (botStatus="menu"), lo que escribe el creador del ticket se toma
 * como la opción elegida (ver chat-bot.service.ts en el backend).
 * Refresca cada 10s para ver respuestas nuevas sin recargar.
 */
export function TicketThread({
  ticket,
  onTicketUpdated
}: {
  ticket: ChatTicket;
  onTicketUpdated?: (ticket: ChatTicket) => void;
}) {
  const { user } = useAuth();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await listChatMessages(ticket.id);
      setMessages(response.data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los mensajes");
    } finally {
      setLoading(false);
    }
  }, [ticket.id]);

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    load();

    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages.length]);

  async function handleDownload(attachment: ChatAttachmentInfo) {
    setDownloadingId(attachment.id);
    setError(null);

    try {
      await downloadChatAttachment(ticket.id, attachment);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo descargar el archivo");
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;

    setSending(true);
    setError(null);

    try {
      const response = await sendChatMessage(ticket.id, text.trim());
      setMessages(response.data.messages);
      setText("");
      onTicketUpdated?.(response.data.ticket);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo enviar el mensaje");
    } finally {
      setSending(false);
    }
  }

  const closed = ticket.status === "cerrado";
  const isCreator = ticket.createdByUserId === user?.id;

  return (
    <div className="ticket-thread">
      <div className="ticket-thread-list" ref={listRef}>
        {loading && messages.length === 0 && <div className="unit-panel-alerts-empty">Cargando...</div>}

        {!loading && messages.length === 0 && !error && (
          <div className="unit-panel-alerts-empty">Sin mensajes todavía</div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={
              message.senderUserId !== null && message.senderUserId === user?.id
                ? "ticket-msg ticket-msg-own"
                : message.senderType === "bot"
                  ? "ticket-msg ticket-msg-bot"
                  : "ticket-msg"
            }
          >
            <div className="ticket-msg-meta">
              {senderLabel(message)} · {formatTime(message.createdAt)}
            </div>
            <div className="ticket-msg-body">{renderBody(message.body)}</div>
            {message.attachments?.map((attachment) => (
              <button
                key={attachment.id}
                type="button"
                className="ticket-msg-attachment"
                disabled={downloadingId === attachment.id}
                onClick={() => handleDownload(attachment)}
              >
                <span className="ticket-msg-attachment-type">PDF</span>
                <span className="ticket-msg-attachment-name">{attachment.fileName}</span>
                <span className="ticket-msg-attachment-size">
                  {downloadingId === attachment.id ? "Descargando..." : formatSize(attachment.sizeBytes)}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>

      {error && <div className="form-error">{error}</div>}

      {closed ? (
        <div className="unit-panel-alerts-empty">Ticket cerrado — no admite más mensajes.</div>
      ) : (
        <form className="ticket-thread-form" onSubmit={handleSend}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              isCreator && ticket.botStatus === "menu" ? "Escribí el número de una opción" : "Escribí un mensaje"
            }
          />
          <button type="submit" className="btn-primary" disabled={sending || !text.trim()}>
            {sending ? "..." : "Enviar"}
          </button>
        </form>
      )}
    </div>
  );
}
