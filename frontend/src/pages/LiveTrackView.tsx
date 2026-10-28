import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, useMap } from "react-leaflet";
import { LatLngBounds, LatLngTuple } from "leaflet";
import "leaflet/dist/leaflet.css";

import { API_BASE_URL } from "../api/client";

/**
 * Página PÚBLICA de seguimiento en vivo (/en-vivo/:token, pedido
 * 2026-10-27) — sin login, fuera de ProtectedRoute. Consulta
 * /public/live/:token cada POLL_INTERVAL_MS pidiendo solo los puntos
 * nuevos (?since=). El dato llega a la base cada
 * UNIT_LIVE_STATUS_SYNC_INTERVAL_SECONDS (15s) y las unidades reportan
 * cada ~6-18s, así que consultar más seguido que cada 10s no mejora
 * la precisión. Se pausa con la pestaña oculta.
 */
const POLL_INTERVAL_MS = 10000;

type Point = [number, number, number, number];

interface RouteTrip {
  startTime: string;
  endTime: string;
  distanceKm: number;
  durationMinutes: number;
  maxSpeed: number;
  points: Point[];
}

interface LiveData {
  /** "historico": recorrido de un rango fijo — sin polling ni seguimiento. */
  mode: "envivo" | "historico";
  rangeFrom: string | null;
  rangeTo: string | null;
  unit: { name: string; plate: string | null };
  expiresAt: string;
  serverTime: string;
  lastPosition: {
    latitude: number;
    longitude: number;
    speed: number | null;
    ignition: string | null;
    recordedAt: string;
  } | null;
  points: Point[];
  truncated: boolean;
  trips: RouteTrip[];
}

type LoadState = "loading" | "ok" | "expired" | "not_found" | "error";

function formatAgo(seconds: number): string {
  if (seconds < 60) return `hace ${seconds} s`;
  if (seconds < 3600) return `hace ${Math.floor(seconds / 60)} min`;
  if (seconds < 48 * 3600) return `hace ${Math.floor(seconds / 3600)} h`;
  return `hace ${Math.floor(seconds / 86400)} días`;
}

function formatRemaining(ms: number): string {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function formatDay(value: string): string {
  return new Date(value).toLocaleDateString("es-SV", {
    timeZone: "America/El_Salvador",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function formatPointTime(ms: number): string {
  return new Date(ms).toLocaleString("es-SV", {
    timeZone: "America/El_Salvador",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatClock(value: string): string {
  return new Date(value).toLocaleTimeString("es-SV", {
    timeZone: "America/El_Salvador",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function formatHour(ms: number): string {
  return new Date(ms).toLocaleTimeString("es-SV", { timeZone: "America/El_Salvador", hour: "2-digit", minute: "2-digit" });
}

function formatShortDay(ms: number): string {
  return new Date(ms).toLocaleDateString("es-SV", { timeZone: "America/El_Salvador", day: "2-digit", month: "2-digit" });
}

/** Encuadra el mapa cada vez que cambia la selección de viaje. */
function FitToPoints({ points, fitKey }: { points: LatLngTuple[]; fitKey: string }) {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 16);
    } else {
      map.fitBounds(new LatLngBounds(points), { padding: [40, 40], maxZoom: 16 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey]);

  return null;
}

/**
 * Sigue a la unidad mientras el usuario no mueva el mapa; si lo
 * mueve, deja de seguir hasta que toque "Centrar".
 */
function FollowUnit({ position, follow, onUserMove, fitTo }: {
  position: LatLngTuple | null;
  follow: boolean;
  onUserMove: () => void;
  fitTo: LatLngTuple[] | null;
}) {
  const map = useMap();
  const didFit = useRef(false);

  useEffect(() => {
    const handler = () => onUserMove();
    map.on("dragstart", handler);
    return () => {
      map.off("dragstart", handler);
    };
  }, [map, onUserMove]);

  useEffect(() => {
    if (didFit.current || !fitTo || fitTo.length === 0) return;
    didFit.current = true;
    if (fitTo.length === 1) {
      map.setView(fitTo[0], 16);
    } else {
      map.fitBounds(new LatLngBounds(fitTo), { padding: [40, 40], maxZoom: 16 });
    }
  }, [map, fitTo]);

  useEffect(() => {
    if (follow && position && didFit.current) {
      map.panTo(position, { animate: true });
    }
  }, [map, position, follow]);

  return null;
}

export function LiveTrackView() {
  const { token = "" } = useParams();

  const [state, setState] = useState<LoadState>("loading");
  const [info, setInfo] = useState<Omit<LiveData, "points" | "trips"> | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [follow, setFollow] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [clockSkew, setClockSkew] = useState(0);
  const [lastCheck, setLastCheck] = useState<number | null>(null);
  const [fitTo, setFitTo] = useState<LatLngTuple[] | null>(null);
  const [trips, setTrips] = useState<RouteTrip[]>([]);
  /** Modo histórico: null = todos los viajes; número = ese viaje. */
  const [selectedTrip, setSelectedTrip] = useState<number | null>(null);

  const lastPointMs = useRef<number | null>(null);
  /** En modo histórico el dato no cambia: se carga una vez y no se consulta más. */
  const historic = useRef(false);

  const poll = useCallback(async () => {
    const since = lastPointMs.current;
    const url = `${API_BASE_URL}/api/v1/public/live/${encodeURIComponent(token)}${since !== null ? `?since=${since}` : ""}`;

    try {
      const response = await fetch(url, { cache: "no-store" });

      if (response.status === 410) {
        setState("expired");
        return;
      }

      if (response.status === 404) {
        setState("not_found");
        return;
      }

      if (!response.ok) {
        throw new Error(String(response.status));
      }

      const body = (await response.json()) as { data: LiveData };
      const data = body.data;

      setClockSkew(new Date(data.serverTime).getTime() - Date.now());
      setInfo((prev) => ({
        mode: data.mode,
        rangeFrom: data.rangeFrom,
        rangeTo: data.rangeTo,
        unit: data.unit,
        expiresAt: data.expiresAt,
        serverTime: data.serverTime,
        truncated: data.truncated || (prev?.truncated ?? false),
        lastPosition: data.lastPosition ?? prev?.lastPosition ?? null
      }));

      if (since === null) {
        setPoints(data.points);
        setTrips(data.trips ?? []);
        const initial: LatLngTuple[] = data.points.length > 0
          ? data.points.map((p) => [p[0], p[1]] as LatLngTuple)
          : data.lastPosition
            ? [[data.lastPosition.latitude, data.lastPosition.longitude]]
            : [];
        setFitTo(initial);
      } else if (data.points.length > 0) {
        setPoints((prev) => [...prev, ...data.points]);
      }

      if (data.points.length > 0) {
        lastPointMs.current = data.points[data.points.length - 1][3];
      } else if (since === null && data.lastPosition) {
        lastPointMs.current = new Date(data.lastPosition.recordedAt).getTime();
      }

      setLastCheck(Date.now());
      setState("ok");

      if (data.mode === "historico") {
        historic.current = true;
      }
    } catch {
      // Un fallo puntual de red no tira la página: se reintenta en el
      // próximo ciclo y se muestra el aviso solo si nunca cargó.
      setState((prev) => (prev === "loading" ? "error" : prev));
    }
  }, [token]);

  useEffect(() => {
    poll();

    const tickPoll = () => {
      if (!historic.current) poll();
    };

    let timer: ReturnType<typeof setInterval> | null = setInterval(tickPoll, POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (document.hidden) {
        if (timer) clearInterval(timer);
        timer = null;
      } else if (!timer) {
        tickPoll();
        timer = setInterval(tickPoll, POLL_INTERVAL_MS);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [poll]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (info && new Date(info.expiresAt).getTime() <= now + clockSkew) {
      setState("expired");
    }
  }, [info, now, clockSkew]);

  const onUserMove = useCallback(() => setFollow(false), []);

  if (state === "expired" || state === "not_found" || state === "error" || (state === "loading" && !info)) {
    const message =
      state === "loading" ? "Cargando seguimiento..." :
      state === "expired" ? "Este link de seguimiento ya venció." :
      state === "not_found" ? "Link de seguimiento no válido." :
      "No se pudo cargar el seguimiento. Revisá tu conexión.";

    return (
      <div className="live-page live-page-center">
        <div className="live-card">
          <div className="app-brand">DADA DADA Fleet</div>
          <p>{message}</p>
          {state === "expired" && <p className="live-muted">Pedí un link nuevo a quien te lo compartió.</p>}
        </div>
      </div>
    );
  }

  const last = info?.lastPosition ?? null;
  const position: LatLngTuple | null = last ? [last.latitude, last.longitude] : null;
  const route: LatLngTuple[] = points.map((p) => [p[0], p[1]]);
  const ageSeconds = last ? Math.max(0, Math.round((now + clockSkew - new Date(last.recordedAt).getTime()) / 1000)) : null;
  const moving = last?.speed !== null && last?.speed !== undefined && last.speed > 2;
  const stale = ageSeconds !== null && ageSeconds > 300;
  const isHistoric = info?.mode === "historico";
  const firstPoint = points[0] ?? null;
  const lastPoint = points[points.length - 1] ?? null;
  const multiDay = isHistoric && !!info?.rangeFrom && !!info?.rangeTo && formatDay(info.rangeFrom) !== formatDay(info.rangeTo);
  const shownTrips = selectedTrip === null ? trips : trips.slice(selectedTrip, selectedTrip + 1);
  const shownStart = shownTrips[0]?.points[0] ?? null;
  const lastShownTrip = shownTrips[shownTrips.length - 1];
  const shownEnd = lastShownTrip ? lastShownTrip.points[lastShownTrip.points.length - 1] ?? null : null;
  const fitPoints: LatLngTuple[] = shownTrips.length > 0
    ? shownTrips.flatMap((t) => t.points.map((p) => [p[0], p[1]] as LatLngTuple))
    : route;
  const totalKm = trips.reduce((sum, t) => sum + t.distanceKm, 0);
  const totalMinutes = trips.reduce((sum, t) => sum + t.durationMinutes, 0);
  const activeTrip = selectedTrip !== null ? trips[selectedTrip] : null;
  const periodLabel = isHistoric && info?.rangeFrom && info.rangeTo
    ? formatDay(info.rangeFrom) === formatDay(info.rangeTo)
      ? `Recorrido del ${formatDay(info.rangeFrom)}`
      : `Recorrido del ${formatDay(info.rangeFrom)} al ${formatDay(info.rangeTo)}`
    : "Seguimiento en vivo";

  return (
    <div className="live-page">
      <header className="live-header">
        <div>
          <div className="live-title">{info?.unit.name}</div>
          <div className="live-muted">
            {info?.unit.plate ? `Placa ${info.unit.plate} · ` : ""}{periodLabel}
          </div>
        </div>
        <div className="live-status">
          {isHistoric ? (
            <span className="badge badge-unknown">Histórico</span>
          ) : (
            <span className={stale ? "badge badge-unknown" : moving ? "badge badge-online" : "badge badge-offline"}>
              {stale ? "Sin reportar" : moving ? `${Math.round(last!.speed!)} km/h` : "Detenido"}
            </span>
          )}
        </div>
      </header>

      <div className="live-map">
        <MapContainer center={position ?? [13.7, -89.2]} zoom={position ? 15 : 9} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {!isHistoric && route.length > 1 && <Polyline positions={route} pathOptions={{ color: "#1d4ed8", weight: 4, opacity: 0.8 }} />}
          {!isHistoric && route.length > 0 && firstPoint && (
            <CircleMarker center={route[0]} radius={7} pathOptions={{ color: "#fff", weight: 2, fillColor: "#15803d", fillOpacity: 1 }}>
              <Popup>Inicio: {formatPointTime(firstPoint[3])}</Popup>
            </CircleMarker>
          )}

          {isHistoric && trips.map((trip, index) => {
            const active = selectedTrip === null || selectedTrip === index;
            return (
              <Polyline
                key={`trip-${index}-${active ? "a" : "i"}`}
                positions={trip.points.map((p) => [p[0], p[1]] as LatLngTuple)}
                pathOptions={
                  selectedTrip === index
                    ? { color: "#1d4ed8", weight: 6, opacity: 1 }
                    : active
                      ? { color: "#1d4ed8", weight: 4, opacity: 0.85 }
                      : { color: "#94a3b8", weight: 3, opacity: 0.5 }
                }
                eventHandlers={{ click: () => setSelectedTrip(index) }}
              />
            );
          })}

          {isHistoric && shownStart && (
            <CircleMarker center={[shownStart[0], shownStart[1]]} radius={7} pathOptions={{ color: "#fff", weight: 2, fillColor: "#15803d", fillOpacity: 1 }}>
              <Popup>Inicio: {formatPointTime(shownStart[3])}</Popup>
            </CircleMarker>
          )}
          {isHistoric && shownEnd && (
            <CircleMarker center={[shownEnd[0], shownEnd[1]]} radius={9} pathOptions={{ color: "#fff", weight: 3, fillColor: "#dc2626", fillOpacity: 1 }}>
              <Popup>Fin: {formatPointTime(shownEnd[3])}</Popup>
            </CircleMarker>
          )}
          {isHistoric && trips.length === 0 && lastPoint && (
            <CircleMarker center={[lastPoint[0], lastPoint[1]]} radius={9} pathOptions={{ color: "#fff", weight: 3, fillColor: "#667085", fillOpacity: 1 }}>
              <Popup>Sin movimiento — {formatPointTime(lastPoint[3])}</Popup>
            </CircleMarker>
          )}
          {isHistoric && <FitToPoints points={fitPoints} fitKey={`${selectedTrip}-${trips.length}`} />}
          {!isHistoric && position && (
            <CircleMarker
              center={position}
              radius={10}
              pathOptions={{ color: "#fff", weight: 3, fillColor: stale ? "#667085" : "#dc2626", fillOpacity: 1 }}
            />
          )}
          <FollowUnit position={position} follow={follow && !isHistoric} onUserMove={onUserMove} fitTo={fitTo} />
        </MapContainer>

        {!isHistoric && !follow && position && (
          <button type="button" className="btn-primary live-recenter" onClick={() => setFollow(true)}>
            Centrar en la unidad
          </button>
        )}
      </div>

      {isHistoric && trips.length > 0 && (
        <div className="live-trips">
          <button
            type="button"
            className={selectedTrip === null ? "trip-chip trip-chip-active" : "trip-chip"}
            onClick={() => setSelectedTrip(null)}
          >
            Todos ({trips.length})
          </button>
          {trips.map((trip, index) => {
            const start = new Date(trip.startTime).getTime();
            const end = new Date(trip.endTime).getTime();
            return (
              <button
                key={index}
                type="button"
                className={selectedTrip === index ? "trip-chip trip-chip-active" : "trip-chip"}
                onClick={() => setSelectedTrip(index)}
              >
                {multiDay ? `${formatShortDay(start)} ` : ""}{formatHour(start)}–{formatHour(end)} · {trip.distanceKm.toFixed(1)} km
              </button>
            );
          })}
        </div>
      )}

      {isHistoric ? (
        <footer className="live-footer">
          {activeTrip ? (
            <div>
              <strong>Viaje {selectedTrip! + 1}:</strong>{" "}
              {formatPointTime(new Date(activeTrip.startTime).getTime())} a {formatHour(new Date(activeTrip.endTime).getTime())}
              {` · ${formatDuration(activeTrip.durationMinutes)} · ${activeTrip.distanceKm.toFixed(1)} km · vel. máx. ${activeTrip.maxSpeed} km/h`}
            </div>
          ) : trips.length > 0 ? (
            <div>
              <strong>{trips.length} viaje(s)</strong>
              {` · ${totalKm.toFixed(1)} km aprox. · ${formatDuration(totalMinutes)} en movimiento`}
            </div>
          ) : (
            <div>
              <strong>Sin viajes en el período</strong>
              {lastPoint && ` · ${route.length} posición(es), la última ${formatPointTime(lastPoint[3])}`}
            </div>
          )}
          <div className="live-muted">
            {info?.truncated ? "Recorrido simplificado para el mapa · " : ""}
            Tocá un viaje en la lista o en el mapa para verlo solo · Verde: inicio · Rojo: fin
            {info ? ` · vence en ${formatRemaining(new Date(info.expiresAt).getTime() - (now + clockSkew))}` : ""}
          </div>
        </footer>
      ) : (
      <footer className="live-footer">
        <div>
          <strong>Última posición:</strong>{" "}
          {last && ageSeconds !== null ? `${formatClock(last.recordedAt)} (${formatAgo(ageSeconds)})` : "sin datos"}
          {last?.ignition && ` · Motor ${last.ignition === "on" ? "encendido" : "apagado"}`}
        </div>
        <div className="live-muted">
          {route.length} puntos hoy{info?.truncated ? " (últimos)" : ""} · se actualiza cada {POLL_INTERVAL_MS / 1000} s
          {lastCheck ? ` · consultado ${formatAgo(Math.max(0, Math.round((now - lastCheck) / 1000)))}` : ""}
          {info ? ` · vence en ${formatRemaining(new Date(info.expiresAt).getTime() - (now + clockSkew))}` : ""}
        </div>
      </footer>
      )}
    </div>
  );
}
