# DMS Fleet — Frontend

Frontend inicial (React + TypeScript + Vite) para dms-api: login +
dashboard de unidades (estado, hora de transmisión, batería).

## Desarrollo local

```bash
npm install
npm run dev
```

Por defecto llama a la API en `http://<mismo host>:3010`. Para apuntar
a otro host, crea `.env.local`:

```
VITE_API_BASE_URL=http://localhost:3010
```

## Producción (Docker)

Se levanta junto con `api`/`db` desde `/opt/dms-api/docker-compose.yml`
(servicio `web`, puerto 3000):

```bash
cd /opt/dms-api
sudo docker compose build web
sudo docker compose up -d web
```

Si la API se sirve en un host/puerto distinto al del frontend, pasar
`VITE_API_BASE_URL` como build arg (ver comentario en
`docker-compose.yml`).

## Estructura

- `src/api/client.ts` — cliente HTTP (base URL, token, manejo de errores).
- `src/auth/` — contexto de sesión (`AuthContext`) y ruta protegida (`ProtectedRoute`).
- `src/pages/Login.tsx` — login.
- `src/pages/Dashboard.tsx` — listado de unidades con estado/batería/hora de transmisión, búsqueda, paginación, auto-refresco cada 30s.

## Pendiente / siguientes pasos sugeridos

- Filtro por compañía.
- Vista de detalle por unidad (mapa, histórico).
- Página de alertas críticas (ya existe el endpoint en la API: `GET /api/v1/tracking/critical-alerts/events`).
- No se inicializó como repositorio git — avisar si se quiere versionar por separado o integrar al repo de la API.
