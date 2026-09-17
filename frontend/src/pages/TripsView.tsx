import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, useMap } from "react-leaflet";
import { LatLngBounds, LatLngTuple } from "leaflet";
import "leaflet/dist/leaflet.css";

import { apiRequest, ApiError } from "../api/client";

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

function formatTime(value: string): string {
  if (!value) return "—";
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  return date.toLocaleTimeString("es-SV", { hour: "2-digit", minute: "2-digit" });
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * MapContainer de react-leaflet solo usa `center`/`zoom` en el montaje
 * inicial — cambiarlos en props no mueve el mapa. Por eso al abrir la
 * ventana (datos todavía no cargados) o al seleccionar otro viaje, el
 * mapa se quedaba en el centro por defecto. Este componente vive
 * dentro del MapContainer y usa el mapa real vía useMap() para
 * reposicionarlo cada vez que cambia el viaje seleccionado.
 */
function RecenterOnTrip({ trip }: { trip: Trip | undefined }) {
  const map = useMap();

  useEffect(() => {
    if (!trip || trip.points.length === 0) return;

    if (trip.points.length === 1) {
      map.setView([trip.points[0].lat, trip.points[0].lng], 15);
      return;
    }

    const bounds = new LatLngBounds(
      trip.points.map((p): LatLngTuple => [p.lat, p.lng])
    );

    map.fitBounds(bounds, { padding: [40, 40] });
  }, [map, trip]);

  return null;
}

export function TripsView() {
  const { unitId } = useParams<{ unitId: string }>();
  const [searchParams] = useSearchParams();
  const date = searchParams.get("date") || todayStr();

  const [unitName, setUnitName] = useState("");
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!unitId) return;

    setLoading(true);
    setError(null);

    try {
      const response = await apiRequest<TripsResponse>(
        `/api/v1/units/${encodeURIComponent(unitId)}/trips?date=${encodeURIComponent(date)}`
      );

      setUnitName(response.data.unit.name);
      setTrips(response.data.trips);
      setSelectedIndex(response.data.trips.length ? response.data.trips.length - 1 : 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      setLoading(false);
    }
  }, [unitId, date]);

  useEffect(() => {
    load();
  }, [load]);

  const selectedTrip = trips[selectedIndex];
  const center: [number, number] = selectedTrip
    ? [selectedTrip.points[0].lat, selectedTrip.points[0].lng]
    : [13.6929, -89.2182];

  return (
    <div className="trips-shell">
      <header className="trips-header">
        <div>
          <div className="app-brand">DADA DADA Fleet</div>
          <div className="trips-subtitle">
            {unitName || "Unidad"} — {date}
          </div>
        </div>
        <button className="btn-secondary" onClick={() => window.close()}>
          Cerrar
        </button>
      </header>

      <div className="trips-body">
        <aside className="trips-list">
          {loading && <div className="table-empty">Cargando viajes...</div>}

          {error && <div className="form-error">{error}</div>}

          {!loading && !error && trips.length === 0 && (
            <div className="table-empty">Sin viajes registrados este día</div>
          )}

          {trips.map((trip, index) => (
            <button
              key={index}
              className={index === selectedIndex ? "trip-card trip-card-active" : "trip-card"}
              onClick={() => setSelectedIndex(index)}
            >
              <div className="trip-card-time">
                {formatTime(trip.startTime)} — {formatTime(trip.endTime)}
              </div>
              <div className="trip-card-meta">
                {trip.durationMinutes} min · {trip.distanceKm ?? "—"} km
              </div>
              <div className="trip-card-address">Desde: {trip.startAddress || "—"}</div>
              <div className="trip-card-address">Hasta: {trip.endAddress || "—"}</div>
            </button>
          ))}
        </aside>

        <div className="trips-map">
          <MapContainer center={center} zoom={14} style={{ height: "100%", width: "100%" }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <RecenterOnTrip trip={selectedTrip} />

            {selectedTrip && (
              <>
                <Polyline
                  positions={selectedTrip.points.map((p) => [p.lat, p.lng])}
                  pathOptions={{ color: "#1d4ed8", weight: 4 }}
                />

                <CircleMarker
                  center={[selectedTrip.points[0].lat, selectedTrip.points[0].lng]}
                  radius={8}
                  pathOptions={{ color: "#15803d", fillColor: "#15803d", fillOpacity: 1 }}
                >
                  <Popup>Inicio — {formatTime(selectedTrip.startTime)}</Popup>
                </CircleMarker>

                <CircleMarker
                  center={[
                    selectedTrip.points[selectedTrip.points.length - 1].lat,
                    selectedTrip.points[selectedTrip.points.length - 1].lng
                  ]}
                  radius={8}
                  pathOptions={{ color: "#b91c1c", fillColor: "#b91c1c", fillOpacity: 1 }}
                >
                  <Popup>Fin — {formatTime(selectedTrip.endTime)}</Popup>
                </CircleMarker>
              </>
            )}
          </MapContainer>
        </div>
      </div>
    </div>
  );
}
