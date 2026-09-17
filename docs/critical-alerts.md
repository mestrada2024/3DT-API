# Alertas críticas

Catálogo local de tipos de alerta crítica (tabla `CriticalAlertType`) —
**no** se sincroniza de 3Dtracking, se define a mano. Se sembró con una
sola alerta:

| code           | name              | description                                              | matchSystemName |
|----------------|-------------------|------------------------------------------------------------|------------------|
| `PANIC_BUTTON` | Botón de pánico   | El conductor activó el botón de pánico del dispositivo     | `panic`          |

`matchSystemName` es el `SystemName` real que reporta 3Dtracking en
`InputOutputs[]` de cada posición — es lo que el escaneo (ver más abajo)
compara para detectar coincidencias. Agregar más tipos por ahora es
directo en la base de datos; avisar si hace falta un endpoint para
crearlas/editarlas desde la API.

Además del catálogo, existe un mecanismo de **detección y
almacenamiento** de eventos de alerta crítica reales, sobre la tabla
`CriticalAlertEvent`.

---

## GET /api/v1/tracking/critical-alerts

Requiere `Authorization: Bearer <token>` (ver [Autenticación](auth.md)).

### Parámetros (querystring)

| Parámetro | Notas                                                        |
|-----------|-------------------------------------------------------------|
| `page`    | Default 1.                                                    |
| `limit`   | Default 20, máx 100.                                           |
| `search`  | Busca coincidencia parcial en `code`, `name`, `description`.  |
| `active`  | `false` para ver las inactivas. Default: solo activas.        |

### Ejemplo

```bash
curl -s http://localhost:3010/api/v1/tracking/critical-alerts \
  -H "Authorization: Bearer $TOKEN"
```

### Respuesta — 200

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "code": "PANIC_BUTTON",
      "name": "Botón de pánico",
      "description": "El conductor activó el botón de pánico del dispositivo",
      "active": true,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "pages": 1 }
}
```

`500 INTERNAL_SERVER_ERROR` en caso de error inesperado.

---

## Escaneo automático (casi en tiempo real)

Desde `src/plugins/critical-alert-scheduler.ts`, el servidor ejecuta
`scanForCriticalAlerts()` en un intervalo recurrente por su cuenta —
**no hace falta llamar a `POST /critical-alerts/scan` a mano** para que
los eventos se guarden. Corre una vez al arrancar y luego cada
`CRITICAL_ALERTS_SCAN_INTERVAL_SECONDS` (default **60s**).

Variables de entorno (opcionales, van en `.env`):

| Variable                                  | Default | Notas                                                    |
|--------------------------------------------|---------|-----------------------------------------------------------|
| `CRITICAL_ALERTS_SCAN_ENABLED`             | `true`  | `false` desactiva el escaneo automático por completo.     |
| `CRITICAL_ALERTS_SCAN_INTERVAL_SECONDS`    | `60`    | Cada cuánto escanear. Mínimo forzado: 5s.                  |

### Cómo detecta las alertas (Data/PositionsList, no LatestPositionsList)

El escaneo usa **`Data/PositionsList`** de 3Dtracking — un stream
cronológico de mensajes de posición de todas las unidades, paginado por
un cursor (`StartId`), con los `InputOutputs[]` de cada mensaje
individual incluidos (`IncludeInputOutputs=true`). El cursor se guarda
en la tabla `CriticalAlertScanCursor` (una sola fila) para que cada
corrida continúe exactamente donde quedó la anterior.

Se eligió este endpoint en vez de `Units/LatestPositionsList` (que solo
expone la posición *más reciente* de cada unidad) por dos problemas
reales confirmados en esta cuenta:

1. **Se pueden perder alarmas puntuales.** El botón de pánico reporta
   `Active:true` solo en el mensaje exacto del evento; en el siguiente
   reporte de posición ya vuelve a `Active:false`. Si el escaneo
   consulta solo "la posición más reciente" y esta ya avanzó al
   siguiente mensaje, la alarma se pierde para siempre — pasó
   exactamente esto la primera vez que se probó con una alerta real.
2. **`Units/LatestPositionsList` puede bloquearse por límite de tasa**
   (`429 Too Many Requests`) en cuentas con mucho tráfico de posiciones
   — bloqueó el escaneo automático por más de 10 minutos seguidos
   durante las pruebas. `Data/PositionsList` no mostró ese problema.

Con `Data/PositionsList`, cada mensaje individual pasa por el escaneo
(no solo el más reciente), así que el mensaje exacto donde la alarma
estuvo activa nunca se pierde, sin importar cuánto tiempo pase entre
una corrida y otra.

Detalles adicionales:

- Si un escaneo todavía está corriendo cuando toca el siguiente
  intervalo, ese tick se salta (no se solapan escaneos).
- Cada corrida procesa hasta 25 páginas (5000 posiciones c/u) antes de
  detenerse — en operación normal alcanza con 1 página; el límite solo
  importa después de una caída larga del servicio, en cuyo caso la
  puesta al día avanza progresivamente a lo largo de varias corridas.
- Un error de 3Dtracking se registra en los logs del servidor y el
  escaneo automático sigue intentando en el siguiente intervalo — no
  tumba el servidor ni pierde el cursor ya avanzado.
- El endpoint `POST /critical-alerts/scan` sigue disponible para forzar
  un escaneo manual en cualquier momento (usa el mismo cursor).

---

## POST /api/v1/tracking/critical-alerts/scan

Dispara un escaneo manual (lo mismo que corre automáticamente, ver
arriba, usando el mismo cursor persistido). Útil para forzar una
detección inmediata o para pruebas, sin esperar al siguiente intervalo
programado.

Deduplicación: la clave natural es `(unitUid, alertTypeCode,
occurredAt)`. Volver a escanear un mensaje ya procesado no crea filas
repetidas — se cuenta como `duplicates`.

Requiere `Authorization: Bearer <token>` (ver [Autenticación](auth.md)).

### Ejemplo

```bash
curl -s -X POST http://localhost:3010/api/v1/tracking/critical-alerts/scan \
  -H "Authorization: Bearer $TOKEN"
```

### Respuesta — 200

```json
{
  "success": true,
  "data": {
    "pagesProcessed": 1,
    "positionsChecked": 143,
    "alertTypesChecked": 1,
    "detected": 1,
    "stored": 1,
    "duplicates": 0
  }
}
```

- `pagesProcessed`: páginas de `Data/PositionsList` consultadas en esta corrida.
- `positionsChecked`: mensajes de posición individuales revisados (todas las unidades).
- `alertTypesChecked`: tipos de alerta activos con `matchSystemName`.
- `detected`: coincidencias activas encontradas en este escaneo.
- `stored`: eventos nuevos guardados.
- `duplicates`: coincidencias ya guardadas antes (mismo `unitUid` +
  `alertTypeCode` + `occurredAt`), no se duplican.

`502 TRACKING3D_ERROR` si 3Dtracking rechaza la consulta — el mensaje
real de 3Dtracking queda en los logs del servidor.

---

## GET /api/v1/tracking/critical-alerts/events

Lista los eventos de alerta crítica ya detectados y guardados (tabla
`CriticalAlertEvent`).

Requiere `Authorization: Bearer <token>` (ver [Autenticación](auth.md)).

### Parámetros (querystring)

| Parámetro        | Notas                                                        |
|------------------|---------------------------------------------------------------|
| `page`           | Default 1.                                                    |
| `limit`          | Default 20, máx 100.                                           |
| `alertTypeCode`  | Filtra por código exacto, ej. `PANIC_BUTTON`.                   |
| `unitUid`        | Filtra por unidad exacta.                                     |
| `search`         | Busca coincidencia parcial en `unitName`, `unitImei`, `description`. |

### Ejemplo

```bash
curl -s "http://localhost:3010/api/v1/tracking/critical-alerts/events?alertTypeCode=PANIC_BUTTON" \
  -H "Authorization: Bearer $TOKEN"
```

### Respuesta — 200

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "alertTypeCode": "PANIC_BUTTON",
      "alertTypeName": "Botón de pánico",
      "unitUid": "22B6C4",
      "unitName": "KIA RIO",
      "unitImei": "865124070335577",
      "companyUid": "2C809B",
      "driverName": "(sin conductor)",
      "latitude": "13.70225",
      "longitude": "-89.2025146",
      "address": "3a Calle Poniente, Centro Histórico, San Salvador, El Salvador",
      "speed": "0",
      "heading": "136",
      "description": "Botón de pánico activado",
      "occurredAt": "2026-09-16T11:41:33.000Z",
      "createdAt": "2026-09-16T16:48:17.754Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "pages": 1 }
}
```

`500 INTERNAL_SERVER_ERROR` en caso de error inesperado.
