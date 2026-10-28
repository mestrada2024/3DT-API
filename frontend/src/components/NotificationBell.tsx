import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  ChatNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead
} from "../api/admin";

const POLL_INTERVAL_MS = 15000;

function formatWhen(value: string): string {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes} min`;
  if (minutes < 48 * 60) return `hace ${Math.floor(minutes / 60)} h`;
  return new Date(value).toLocaleDateString("es-SV", { timeZone: "America/El_Salvador" });
}

function browserNotificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/**
 * Campana de notificaciones internas (pedido 2026-10-27: avisar a los
 * agentes y supervisores de la cola cuando un cliente escribe
 * "agente"). Consulta cada 15s; si hay nuevas y el usuario dio
 * permiso, además muestra una notificación del navegador (sirve con
 * la pestaña en segundo plano, no con el navegador cerrado).
 */
export function NotificationBell() {
  const navigate = useNavigate();

  const [items, setItems] = useState<ChatNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    browserNotificationsSupported() ? Notification.permission : "unsupported"
  );

  const lastSeenId = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const openTicket = useCallback(
    async (notification: ChatNotification) => {
      setOpen(false);

      if (!notification.readAt) {
        try {
          await markNotificationRead(notification.id);
        } catch {
          // Silencioso: igual se abre el ticket; se marcará en otro intento.
        }
        setItems((prev) => prev.map((n) => (n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n)));
        setUnread((prev) => Math.max(0, prev - 1));
      }

      if (notification.ticketId) {
        navigate(`/tickets?ticket=${notification.ticketId}`);
      }
    },
    [navigate]
  );

  const poll = useCallback(async () => {
    try {
      const response = await listNotifications();
      const { items: fresh, unread: count } = response.data;

      setItems(fresh);
      setUnread(count);

      const maxId = fresh.reduce((max, n) => Math.max(max, n.id), 0);

      /** Primera carga: no dispara avisos por lo que ya existía. */
      if (lastSeenId.current !== null && browserNotificationsSupported() && Notification.permission === "granted") {
        fresh
          .filter((n) => n.id > (lastSeenId.current ?? 0) && !n.readAt)
          .reverse()
          .forEach((n) => {
            const native = new Notification(n.title, { body: n.body, tag: `dms-notif-${n.id}` });
            native.onclick = () => {
              window.focus();
              openTicket(n);
              native.close();
            };
          });
      }

      lastSeenId.current = Math.max(lastSeenId.current ?? 0, maxId);
    } catch {
      // Silencioso: la campana es informativa, se reintenta en el próximo ciclo.
    }
  }, [openTicket]);

  useEffect(() => {
    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function enableBrowserNotifications() {
    if (!browserNotificationsSupported()) return;
    setPermission(await Notification.requestPermission());
  }

  async function handleReadAll() {
    try {
      await markAllNotificationsRead();
      setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })));
      setUnread(0);
    } catch {
      // Silencioso: el próximo poll trae el estado real.
    }
  }

  return (
    <div className="notif" ref={rootRef}>
      <button
        type="button"
        className="notif-button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread > 0 ? `Notificaciones, ${unread} sin leer` : "Notificaciones"}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && <span className="app-nav-badge notif-badge">{unread > 99 ? "99+" : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-panel-header">
            <strong>Notificaciones</strong>
            {unread > 0 && (
              <button type="button" className="btn-link" onClick={handleReadAll}>
                Marcar todo como leído
              </button>
            )}
          </div>

          {permission === "default" && (
            <button type="button" className="btn-secondary notif-enable" onClick={enableBrowserNotifications}>
              Activar avisos del navegador
            </button>
          )}
          {permission === "denied" && (
            <div className="unit-panel-alerts-empty">
              Los avisos del navegador están bloqueados; habilitalos en la configuración del sitio.
            </div>
          )}

          {items.length === 0 && <div className="unit-panel-alerts-empty">Sin notificaciones</div>}

          <ul className="notif-list">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={n.readAt ? "notif-item" : "notif-item notif-item-unread"}
                  onClick={() => openTicket(n)}
                >
                  <span className="notif-item-title">{n.title}</span>
                  <span className="notif-item-body">{n.body}</span>
                  <span className="notif-item-when">{formatWhen(n.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
