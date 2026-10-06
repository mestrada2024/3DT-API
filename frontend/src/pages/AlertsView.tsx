import { useCallback, useEffect, useState } from "react";

import { AppHeader } from "../components/AppHeader";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import {
  CriticalAlertEventRow,
  listCriticalAlertEvents,
  markCriticalAlertEventRead,
  previewCriticalAlertWhatsapp,
  resendCriticalAlertWhatsapp
} from "../api/admin";

const PAGE_SIZE = 20;

function whatsappBadgeClass(status: string | null): string {
  if (status === "sent") return "badge badge-online";
  if (status === "error") return "badge badge-offline";
  return "badge badge-unknown";
}

function whatsappBadgeLabel(status: string | null): string {
  if (status === "sent") return "Enviado";
  if (status === "error") return "Error";
  if (status === "sending") return "Enviando...";
  return "Pendiente";
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

export function AlertsView() {
  const { user } = useAuth();
  const canResendWhatsapp = user?.role === "root" || user?.role === "admin";

  const [events, setEvents] = useState<CriticalAlertEventRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [actionId, setActionId] = useState<number | null>(null);

  const load = useCallback(
    async (targetPage: number, searchTerm: string, unreadOnly: boolean) => {
      setLoading(true);
      setError(null);

      try {
        const response = await listCriticalAlertEvents({
          page: targetPage,
          limit: PAGE_SIZE,
          search: searchTerm.trim() || undefined,
          read: unreadOnly ? false : undefined
        });
        setEvents(response.data);
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
    load(page, search, onlyUnread);
  }, [page, search, onlyUnread, load]);

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPage(1);
    load(1, search, onlyUnread);
  }

  function toggleOnlyUnread() {
    setOnlyUnread((v) => !v);
    setPage(1);
  }

  async function handleToggleRead(alertEvent: CriticalAlertEventRow) {
    setActionId(alertEvent.id);

    try {
      const nextRead = !alertEvent.read;
      await markCriticalAlertEventRead(alertEvent.id, nextRead);
      setEvents((prev) =>
        prev.map((e) =>
          e.id === alertEvent.id
            ? { ...e, read: nextRead, readAt: nextRead ? new Date().toISOString() : null }
            : e
        )
      );
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : "No se pudo actualizar el estado de lectura");
    } finally {
      setActionId(null);
    }
  }

  async function handleResendWhatsapp(alertEvent: CriticalAlertEventRow) {
    setActionId(alertEvent.id);

    let preview;

    try {
      const response = await previewCriticalAlertWhatsapp(alertEvent.id);
      preview = response.data;
    } catch (err) {
      setActionId(null);
      window.alert(err instanceof ApiError ? err.message : "No se pudo preparar la vista previa del mensaje");
      return;
    }

    if (!preview.configured || !preview.message || preview.phones.length === 0) {
      setActionId(null);
      window.alert(preview.reason || "No se puede reenviar este evento por WhatsApp");
      return;
    }

    const confirmText =
      `Se va a enviar este mensaje a ${preview.phones.length} número(s):
` +
      `${preview.phones.join(", ")}

` +
      `"${preview.message}"

` +
      `¿Confirmás el envío?`;

    if (!window.confirm(confirmText)) {
      setActionId(null);
      return;
    }

    try {
      await resendCriticalAlertWhatsapp(alertEvent.id);
      load(page, search, onlyUnread);
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : "No se pudo reenviar el mensaje de WhatsApp");
    } finally {
      setActionId(null);
    }
  }

  return (
    <div className="app-shell">
      <AppHeader />

      <main className="app-main">
        <div className="dashboard-toolbar">
          <h1>Alertas</h1>

          <div className="toolbar-actions">
            <form className="search-form" onSubmit={handleSearchSubmit}>
              <input
                type="text"
                placeholder="Buscar por unidad, IMEI o descripción"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button type="submit" className="btn-secondary">Buscar</button>
            </form>

            <label className="toggle">
              <input type="checkbox" checked={onlyUnread} onChange={toggleOnlyUnread} />
              <span>Solo no leídas</span>
            </label>
          </div>
        </div>

        <div className="dashboard-meta">
          <span>{total} alertas</span>
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Fecha / Hora</th>
                <th>Alerta</th>
                <th>Unidad</th>
                <th>Conductor</th>
                <th>Dirección</th>
                <th>WhatsApp</th>
                <th>Leída</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && events.length === 0 && (
                <tr><td colSpan={8} className="table-empty">Cargando alertas...</td></tr>
              )}

              {!loading && events.length === 0 && !error && (
                <tr><td colSpan={8} className="table-empty">No se encontraron alertas</td></tr>
              )}

              {events.map((alertEvent) => (
                <tr key={alertEvent.id} className={alertEvent.read ? undefined : "row-unread"}>
                  <td>{formatDateTime(alertEvent.occurredAt)}</td>
                  <td>{alertEvent.alertTypeName}</td>
                  <td>
                    <div className="unit-name">{alertEvent.unitName || alertEvent.unitUid}</div>
                  </td>
                  <td>{alertEvent.driverName || "—"}</td>
                  <td>{alertEvent.address || "—"}</td>
                  <td>
                    <span className={whatsappBadgeClass(alertEvent.whatsappStatus)}>
                      {whatsappBadgeLabel(alertEvent.whatsappStatus)}
                    </span>
                  </td>
                  <td>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={alertEvent.read}
                        disabled={actionId === alertEvent.id}
                        onChange={() => handleToggleRead(alertEvent)}
                      />
                      <span>{alertEvent.read ? "Sí" : "No"}</span>
                    </label>
                  </td>
                  <td>
                    {canResendWhatsapp && (
                      <button
                        type="button"
                        className="btn-link"
                        disabled={actionId === alertEvent.id || !alertEvent.contactPhone}
                        onClick={() => handleResendWhatsapp(alertEvent)}
                        title={!alertEvent.contactPhone ? "Este evento no tiene un contacto asociado" : undefined}
                      >
                        Reenviar WhatsApp
                      </button>
                    )}
                  </td>
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
