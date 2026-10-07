import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { AppHeader } from "../components/AppHeader";
import { SortableHeader, SortDirection } from "../components/SortableHeader";
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

  const [searchParams, setSearchParams] = useSearchParams();

  const [events, setEvents] = useState<CriticalAlertEventRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [unitUidFilter, setUnitUidFilter] = useState(() => searchParams.get("unitUid") || "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * sortBy vacío = sin orden elegido a mano todavía → el backend
   * aplica su default (pendientes de WhatsApp primero, pedido
   * explícito del usuario 2026-10-06). Apenas se hace click en una
   * columna, sortBy pasa a tener ese campo y manda desde ahí.
   */
  const [sortBy, setSortBy] = useState("");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  const [actionId, setActionId] = useState<number | null>(null);

  const load = useCallback(
    async (
      targetPage: number,
      searchTerm: string,
      unreadOnly: boolean,
      unitUid: string,
      sortField: string,
      sortDirection: SortDirection
    ) => {
      setLoading(true);
      setError(null);

      try {
        const response = await listCriticalAlertEvents({
          page: targetPage,
          limit: PAGE_SIZE,
          search: searchTerm.trim() || undefined,
          read: unreadOnly ? false : undefined,
          unitUid: unitUid || undefined,
          sortBy: sortField || undefined,
          sortDir: sortField ? sortDirection : undefined
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
    load(page, search, onlyUnread, unitUidFilter, sortBy, sortDir);
  }, [page, search, onlyUnread, unitUidFilter, sortBy, sortDir, load]);

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPage(1);
    load(1, search, onlyUnread, unitUidFilter, sortBy, sortDir);
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

  function clearUnitUidFilter() {
    setUnitUidFilter("");
    setPage(1);
    searchParams.delete("unitUid");
    setSearchParams(searchParams);
  }

  function toggleOnlyUnread() {
    setOnlyUnread((v) => !v);
    setPage(1);
  }

  async function handleSetRead(alertEvent: CriticalAlertEventRow, read: boolean) {
    if (alertEvent.read === read) return;

    setActionId(alertEvent.id);

    try {
      await markCriticalAlertEventRead(alertEvent.id, read);
      setEvents((prev) =>
        prev.map((e) =>
          e.id === alertEvent.id
            ? { ...e, read, readAt: read ? new Date().toISOString() : null }
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

    if (!preview.configured || !preview.message) {
      setActionId(null);
      window.alert(preview.reason || "No se puede reenviar este evento por WhatsApp");
      return;
    }

    const configuredLabel =
      preview.phones.length > 0
        ? `Números configurados en la empresa: ${preview.phones.join(", ")}`
        : "Esta empresa no tiene números configurados para esta alerta.";

    const customInput = window.prompt(
      `${configuredLabel}

` +
        `Dejá vacío para enviar a esos números, o escribí un número (ej. 50377XXXXXX) para enviar solo a ese destino:`,
      ""
    );

    if (customInput === null) {
      setActionId(null);
      return;
    }

    const overridePhone = customInput.trim() || undefined;
    const targetPhones = overridePhone ? [overridePhone] : preview.phones;

    if (targetPhones.length === 0) {
      setActionId(null);
      window.alert("No hay ningún número destino — escribí uno para poder enviar");
      return;
    }

    const confirmText =
      `Se va a enviar este mensaje a ${targetPhones.length} número(s):
` +
      `${targetPhones.join(", ")}

` +
      `"${preview.message}"

` +
      `¿Confirmás el envío?`;

    if (!window.confirm(confirmText)) {
      setActionId(null);
      return;
    }

    try {
      await resendCriticalAlertWhatsapp(alertEvent.id, overridePhone);
      load(page, search, onlyUnread, unitUidFilter, sortBy, sortDir);
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
          {unitUidFilter && (
            <span className="badge badge-unknown">
              Unidad: {unitUidFilter}
              <button type="button" className="btn-link" onClick={clearUnitUidFilter} style={{ marginLeft: 6 }}>
                ✕
              </button>
            </span>
          )}
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <SortableHeader label="Fecha / Hora" field="occurredAt" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Alerta" field="alertTypeName" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Unidad" field="unitName" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <th>Conductor</th>
                <th>Dirección</th>
                <SortableHeader label="WhatsApp" field="whatsappStatus" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Leída" field="read" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
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
                    <div className="radio-group">
                      <label>
                        <input
                          type="radio"
                          name={`read-${alertEvent.id}`}
                          checked={alertEvent.read}
                          disabled={actionId === alertEvent.id}
                          onChange={() => handleSetRead(alertEvent, true)}
                        />
                        Sí
                      </label>
                      <label>
                        <input
                          type="radio"
                          name={`read-${alertEvent.id}`}
                          checked={!alertEvent.read}
                          disabled={actionId === alertEvent.id}
                          onChange={() => handleSetRead(alertEvent, false)}
                        />
                        No
                      </label>
                    </div>
                  </td>
                  <td>
                    {canResendWhatsapp && (
                      <button
                        type="button"
                        className="btn-link"
                        disabled={actionId === alertEvent.id}
                        onClick={() => handleResendWhatsapp(alertEvent)}
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
