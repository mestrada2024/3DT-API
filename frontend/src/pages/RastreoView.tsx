import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MapContainer, TileLayer, CircleMarker, Polyline, Popup, useMap } from "react-leaflet";
import { LatLngBounds, LatLngTuple } from "leaflet";
import "leaflet/dist/leaflet.css";

import { AppHeader } from "../components/AppHeader";
import { useAuth } from "../auth/AuthContext";
import { apiRequest, ApiError } from "../api/client";
import { CriticalAlertEventRow, listCriticalAlertEvents, listUnitsForTracking, TrackingUnit } from "../api/admin";

const REFRESH_INTERVAL_MS = 30000;
const STALE_AFTER_MS = 30 * 60 * 1000;
const DEFAULT_CENTER: [number, number] = [13.6929, -89.2182];

interface TripPoint {
  lat: number;
  lng: number;
  time: string;
  speed: number;
}

interface Trip {
  startTime: string;
  endTime: string;
  startAddress: string | null;
  endAddress: string | null;
  distanceKm: number | null;
  durationMinutes: number;
  points: TripPoint[];
}

interface TripsResponse {
  success: boolean;
  data: {
    unit: { externalId: string; name: string };
    date: string;
    positionsChecked: number;
    trips: Trip[];
  };
}

function isStale(value: string | null): boolean {
  if (!value) return true;
  return Date.now() - new Date(value).getTime() > STALE_AFTER_MS;
}

function formatLastTransmission(value: string | null): string {
  if (!value) return "Sin datos";

  const diffMinutes = Math.floor((Date.now() - new Date(value).getTime()) / 60000);

  if (diffMinutes < 1) return "Hace instantes";
  if (diffMinutes < 60) return `Hace ${diffMinutes} min`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `Hace ${diffHours} h`;

  return `Hace ${Math.floor(diffHours / 24)} d`;
}

function formatAlertTime(value: string): string {
  return new Date(value).toLocaleString("es-SV", {
    timeZone: "America/El_Salvador",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatTripTime(value: string): string {
  if (!value) return "—";
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  return date.toLocaleTimeString("es-SV", { hour: "2-digit", minute: "2-digit" });
}

function markerColor(unit: TrackingUnit): string {
  return isStale(unit.lastPositionAt) ? "#667085" : "#15803d";
}

/**
 * "Inactiv"/"suspend" van primero a propósito: "inactivo" contiene
 * "activ" como substring (mismo criterio que Dashboard.tsx).
 */
function statusClass(status: string): string {
  const normalized = status.toLowerCase();

  if (normalized.includes("inactiv") || normalized.includes("suspend")) {
    return "badge badge-offline";
  }

  if (normalized.includes("activ")) {
    return "badge badge-online";
  }

  return "badge badge-unknown";
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Al cargar la primera tanda de unidades (o cuando ninguna está
 * seleccionada), encuadra el mapa para mostrar toda la flota visible.
 * Solo se ejecuta una vez — no vuelve a encuadrar en cada refresh
 * automático, para no sacarle el zoom/paneo al usuario cada 30s.
 */
function FitAllUnitsOnce({ units }: { units: TrackingUnit[] }) {
  const map = useMap();
  const didFit = useRef(false);

  useEffect(() => {
    if (didFit.current) return;

    const withPosition = units.filter((u) => u.latitude !== null && u.longitude !== null);
    if (withPosition.length === 0) return;

    didFit.current = true;

    if (withPosition.length === 1) {
      map.setView([Number(withPosition[0].latitude), Number(withPosition[0].longitude)], 14);
      return;
    }

    const bounds = new LatLngBounds(
      withPosition.map((u): LatLngTuple => [Number(u.latitude), Number(u.longitude)])
    );

    map.fitBounds(bounds, { padding: [40, 40] });
  }, [map, units]);

  return null;
}

/**
 * MapContainer solo respeta center/zoom al montar — para centrar en la
 * unidad seleccionada hay que moverlo a mano vía useMap(). Se mueve
 * una sola vez por selección (no en cada refresh de posición) para no
 * pelearle al usuario si está paneando el mapa manualmente.
 */
function RecenterOnUnit({ unit }: { unit: TrackingUnit | undefined }) {
  const map = useMap();
  const lastCenteredId = useRef<number | null>(null);

  useEffect(() => {
    if (!unit || unit.latitude === null || unit.longitude === null) return;
    if (lastCenteredId.current === unit.id) return;

    lastCenteredId.current = unit.id;
    map.setView([Number(unit.latitude), Number(unit.longitude)], 15);
  }, [map, unit]);

  return null;
}

/**
 * Encuadra el mapa al recorrido activo cada vez que cambia (unidad
 * nueva o se eligió otro viaje del día) — igual patrón que
 * TripsView.RecenterOnTrip, reimplementado acá porque ese componente
 * vive dentro de un MapContainer distinto (la ventana emergente de
 * Trips), no se puede compartir directamente entre los dos mapas.
 */
function FitOnTrip({ trip }: { trip: Trip | null }) {
  const map = useMap();

  useEffect(() => {
    if (!trip || trip.points.length === 0) return;

    if (trip.points.length === 1) {
      map.setView([trip.points[0].lat, trip.points[0].lng], 15);
      return;
    }

    const bounds = new LatLngBounds(trip.points.map((p): LatLngTuple => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [map, trip]);

  return null;
}

function UnitAlertsPreview({ unitUid }: { unitUid: string }) {
  const [alerts, setAlerts] = useState<CriticalAlertEventRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    listCriticalAlertEvents({ page: 1, limit: 3, unitUid })
      .then((response) => {
        if (!cancelled) setAlerts(response.data);
      })
      .catch(() => {
        if (!cancelled) setAlerts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [unitUid]);

  if (loading) {
    return <div className="unit-panel-alerts-empty">Cargando alarmas...</div>;
  }

  if (alerts.length === 0) {
    return <div className="unit-panel-alerts-empty">Sin alarmas registradas</div>;
  }

  return (
    <ul className="unit-panel-alerts-list">
      {alerts.map((alert) => (
        <li key={alert.id}>
          <strong>{alert.alertTypeName}</strong> — {formatAlertTime(alert.occurredAt)}
        </li>
      ))}
    </ul>
  );
}

interface TripsState {
  loading: boolean;
  error: string | null;
  trips: Trip[] | null;
  selectedIndex: number;
}

function UnitDetailPanel({
  unit,
  isRoot,
  tripsState,
  onLoadTrips,
  onSelectTrip,
  onHideTrips,
  onClose
}: {
  unit: TrackingUnit;
  isRoot: boolean;
  tripsState: TripsState;
  onLoadTrips: () => void;
  onSelectTrip: (index: number) => void;
  onHideTrips: () => void;
  onClose: () => void;
}) {
  return (
    <div className="unit-panel">
      <div className="unit-panel-header">
        <div>
          <div className="unit-panel-title">{unit.name}</div>
          <div className="unit-panel-subtitle">
            {unit.plate || "Sin placa"}
            {isRoot && unit.companyName ? ` · ${unit.companyName}` : ""}
          </div>
        </div>
        <button type="button" className="unit-panel-close" onClick={onClose} aria-label="Cerrar">
          ✕
        </button>
      </div>

      <div className="unit-panel-row">
        <span className={statusClass(unit.status)}>{unit.status}</span>
        {unit.latitude !== null && (
          <span className={isStale(unit.lastPositionAt) ? "badge badge-unknown" : "badge badge-online"}>
            {isStale(unit.lastPositionAt) ? "Sin transmitir" : "En línea"}
          </span>
        )}
      </div>

      <div className="unit-panel-facts">
        <div>
          <span className="unit-panel-fact-label">Velocidad</span>
          <span>{unit.speed !== null ? `${unit.speed} km/h` : "—"}</span>
        </div>
        <div>
          <span className="unit-panel-fact-label">Última posición</span>
          <span>{formatLastTransmission(unit.lastPositionAt)}</span>
        </div>
      </div>

      <div className="unit-panel-section">
        <div className="unit-panel-section-title">Alarmas recientes</div>
        <UnitAlertsPreview unitUid={unit.externalId} />
        <Link to={`/alertas?unitUid=${encodeURIComponent(unit.externalId)}`} target="_blank" className="btn-link">
          Ver todas las alertas de esta unidad
        </Link>
      </div>

      <div className="unit-panel-section">
        <div className="unit-panel-section-title">Recorrido de hoy</div>

        {tripsState.trips === null && !tripsState.loading && (
          <button type="button" className="btn-secondary" onClick={onLoadTrips}>
            Ver recorrido de hoy
          </button>
        )}

        {tripsState.loading && <div className="unit-panel-alerts-empty">Cargando recorrido...</div>}

        {tripsState.error && <div className="form-error">{tripsState.error}</div>}

        {tripsState.trips !== null && !tripsState.loading && tripsState.trips.length === 0 && (
          <div className="unit-panel-alerts-empty">Sin viajes registrados hoy</div>
        )}

        {tripsState.trips !== null && tripsState.trips.length > 0 && (
          <>
            <div className="unit-panel-trip-list">
              {tripsState.trips.map((trip, index) => (
                <button
                  key={index}
                  type="button"
                  className={index === tripsState.selectedIndex ? "trip-chip trip-chip-active" : "trip-chip"}
                  onClick={() => onSelectTrip(index)}
                >
                  {formatTripTime(trip.startTime)}–{formatTripTime(trip.endTime)}
                </button>
              ))}
            </div>
            <button type="button" className="btn-link" onClick={onHideTrips}>
              Ocultar recorrido
            </button>
          </>
        )}
      </div>

      <div className="unit-panel-actions">
        <Link
          to={`/admin/vehiculos?search=${encodeURIComponent(unit.plate || unit.name)}`}
          target="_blank"
          className="btn-secondary"
        >
          Configurar unidad
        </Link>
      </div>
    </div>
  );
}

const EMPTY_TRIPS_STATE: TripsState = { loading: false, error: null, trips: null, selectedIndex: 0 };

export function RastreoView() {
  const { user } = useAuth();
  const isRoot = user?.role === "root";

  const [units, setUnits] = useState<TrackingUnit[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedCompanyUid, setSelectedCompanyUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tripsState, setTripsState] = useState<TripsState>(EMPTY_TRIPS_STATE);

  const load = useCallback(async (searchTerm: string) => {
    try {
      const response = await listUnitsForTracking({ search: searchTerm.trim() || undefined });
      setUnits(response.data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load(search);

    const interval = setInterval(() => load(search), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [search, load]);

  /**
   * El recorrido mostrado es de la unidad seleccionada — al cambiar de
   * unidad (o deseleccionar) se limpia, no tiene sentido seguir
   * mostrando el recorrido de otra unidad.
   */
  useEffect(() => {
    setTripsState(EMPTY_TRIPS_STATE);
  }, [selectedId]);

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    load(search);
  }

  async function handleLoadTrips(unit: TrackingUnit) {
    setTripsState({ loading: true, error: null, trips: null, selectedIndex: 0 });

    try {
      const response = await apiRequest<TripsResponse>(
        `/api/v1/units/${encodeURIComponent(unit.externalId)}/trips?date=${todayStr()}`
      );

      setTripsState({
        loading: false,
        error: null,
        trips: response.data.trips,
        selectedIndex: response.data.trips.length ? response.data.trips.length - 1 : 0
      });
    } catch (err) {
      setTripsState({
        loading: false,
        error: err instanceof ApiError ? err.message : "No se pudo cargar el recorrido",
        trips: null,
        selectedIndex: 0
      });
    }
  }

  const companies = useMemo(() => {
    const map = new Map<string, string>();

    for (const u of units) {
      if (u.companyUid) map.set(u.companyUid, u.companyName || u.companyUid);
    }

    return [...map.entries()]
      .map(([uid, name]) => ({ uid, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [units]);

  /**
   * Primera carga: se muestra la primera empresa a la que el usuario
   * tiene acceso (pedido explícito del usuario, 2026-10-06), no todas
   * mezcladas. El selector permite cambiar a otra empresa (o a
   * "Todas") una vez que el usuario lo elige a mano — a partir de ahí
   * su elección manda, incluso si la lista de unidades se refresca.
   */
  const effectiveCompanyUid = selectedCompanyUid ?? companies[0]?.uid ?? "all";

  const filteredUnits =
    effectiveCompanyUid === "all" ? units : units.filter((u) => u.companyUid === effectiveCompanyUid);

  const withPosition = filteredUnits.filter((u) => u.latitude !== null && u.longitude !== null);
  const selectedUnit = filteredUnits.find((u) => u.id === selectedId);
  const activeTrip = tripsState.trips?.[tripsState.selectedIndex] || null;

  return (
    <div className="app-shell">
      <AppHeader />

      <div className="rastreo-page">
        <div className="rastreo-toolbar">
          <form className="search-form" onSubmit={handleSearchSubmit}>
            <input
              type="text"
              placeholder="Buscar por unidad o placa"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button type="submit" className="btn-secondary">Buscar</button>
          </form>

          {companies.length > 1 ? (
            <select
              className="inline-input"
              value={effectiveCompanyUid}
              onChange={(e) => {
                setSelectedCompanyUid(e.target.value);
                setSelectedId(null);
              }}
            >
              {companies.map((c) => (
                <option key={c.uid} value={c.uid}>{c.name}</option>
              ))}
              <option value="all">Todas las empresas</option>
            </select>
          ) : (
            companies[0] && <span className="dashboard-meta">{companies[0].name}</span>
          )}

          <span className="dashboard-meta">
            {withPosition.length} de {filteredUnits.length} unidades con posición
          </span>
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="trips-body">
          <aside className="trips-list">
            {loading && filteredUnits.length === 0 && (
              <div className="table-empty">Cargando unidades...</div>
            )}

            {!loading && filteredUnits.length === 0 && !error && (
              <div className="table-empty">No se encontraron unidades</div>
            )}

            {filteredUnits.map((unit) => (
              <button
                key={unit.id}
                className={unit.id === selectedId ? "trip-card trip-card-active" : "trip-card"}
                onClick={() => setSelectedId(unit.id)}
              >
                <div className="trip-card-time">{unit.name}</div>
                <div className="trip-card-meta">
                  {unit.plate || "Sin placa"}
                  {isRoot && unit.companyName ? ` · ${unit.companyName}` : ""}
                </div>
                <div className="trip-card-address">
                  {unit.latitude !== null && unit.longitude !== null ? (
                    <>
                      {unit.speed !== null ? `${unit.speed} km/h · ` : ""}
                      {formatLastTransmission(unit.lastPositionAt)}
                    </>
                  ) : (
                    "Sin posición conocida"
                  )}
                </div>
              </button>
            ))}
          </aside>

          <div className="trips-map">
            <MapContainer center={DEFAULT_CENTER} zoom={12} style={{ height: "100%", width: "100%" }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              <FitAllUnitsOnce units={filteredUnits} />
              <RecenterOnUnit unit={selectedUnit} />
              <FitOnTrip trip={activeTrip} />

              {withPosition.map((unit) => (
                <CircleMarker
                  key={unit.id}
                  center={[Number(unit.latitude), Number(unit.longitude)]}
                  radius={unit.id === selectedId ? 10 : 7}
                  pathOptions={{
                    color: markerColor(unit),
                    fillColor: markerColor(unit),
                    fillOpacity: 0.9,
                    weight: unit.id === selectedId ? 3 : 1
                  }}
                  eventHandlers={{ click: () => setSelectedId(unit.id) }}
                >
                  <Popup>
                    <strong>{unit.name}</strong>
                    <br />
                    {unit.plate || "Sin placa"}
                    <br />
                    {unit.speed !== null ? `${unit.speed} km/h` : "Velocidad desconocida"}
                    <br />
                    {formatLastTransmission(unit.lastPositionAt)}
                  </Popup>
                </CircleMarker>
              ))}

              {activeTrip && (
                <>
                  <Polyline
                    positions={activeTrip.points.map((p) => [p.lat, p.lng])}
                    pathOptions={{ color: "#1d4ed8", weight: 4 }}
                  />

                  <CircleMarker
                    center={[activeTrip.points[0].lat, activeTrip.points[0].lng]}
                    radius={8}
                    pathOptions={{ color: "#15803d", fillColor: "#15803d", fillOpacity: 1 }}
                  >
                    <Popup>Inicio — {formatTripTime(activeTrip.startTime)}</Popup>
                  </CircleMarker>

                  <CircleMarker
                    center={[
                      activeTrip.points[activeTrip.points.length - 1].lat,
                      activeTrip.points[activeTrip.points.length - 1].lng
                    ]}
                    radius={8}
                    pathOptions={{ color: "#b91c1c", fillColor: "#b91c1c", fillOpacity: 1 }}
                  >
                    <Popup>Fin — {formatTripTime(activeTrip.endTime)}</Popup>
                  </CircleMarker>
                </>
              )}
            </MapContainer>

            {selectedUnit && (
              <UnitDetailPanel
                unit={selectedUnit}
                isRoot={isRoot}
                tripsState={tripsState}
                onLoadTrips={() => handleLoadTrips(selectedUnit)}
                onSelectTrip={(index) => setTripsState((prev) => ({ ...prev, selectedIndex: index }))}
                onHideTrips={() => setTripsState(EMPTY_TRIPS_STATE)}
                onClose={() => setSelectedId(null)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
