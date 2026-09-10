# Trackers

Tabla local `Tracker` sincronizada desde 3Dtracking (`GET
devices/tracker/list`) — el inventario real de trackers/GPS físicos de la
cuenta (no confundir con `devices/trackertype/list`, un catálogo aparte que
está vacío en esta cuenta y no se usa aquí). Se sincroniza
**automáticamente cada domingo a las 00:00** (zona horaria
`America/El_Salvador`, configurable con `SCHEDULER_TIMEZONE`).

Todos los endpoints requieren autenticación (`Authorization: Bearer <token>`).

---

## GET /api/v1/tracking/trackers/local

Lista/busca en la tabla local.

### Parámetros (querystring)

| Parámetro | Notas                                                              |
|-----------|----------------------------------------------------------------------|
| `page`    | Default 1.                                                            |
| `limit`   | Default 20, máx 100.                                                  |
| `search`  | Busca coincidencia parcial en `uid`, `name`, `imei`, `trackerTypeName`, `unitModelName`. |

### Ejemplo

```bash
curl -s "http://localhost:3010/api/v1/tracking/trackers/local?search=ATrack" \
  -H "Authorization: Bearer $TOKEN"
```

### Respuesta — 200

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "uid": "F1DEF6",
      "name": "354762116908317",
      "imei": "354762116908317",
      "trackerTypeUid": "UT127",
      "trackerTypeName": "ATrack",
      "unitModelUid": "UM89",
      "unitModelName": "AK7(S)",
      "simUid": "EF08AB",
      "activationCode": null,
      "createdDateTimeUtc": "2026-07-30T18:07:30.240Z",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "pages": 1 }
}
```

---

## POST /api/v1/tracking/trackers/sync

Fuerza una sincronización inmediata (la misma lógica que corre
automáticamente cada domingo). Upsert por `uid`.

```bash
curl -s -X POST http://localhost:3010/api/v1/tracking/trackers/sync \
  -H "Authorization: Bearer $TOKEN"
```

### Respuesta — 200

```json
{
  "success": true,
  "data": { "total": 285, "created": 285, "updated": 0, "errors": 0 }
}
```

`502 TRACKING3D_SYNC_ERROR` si no se pudo consultar 3Dtracking.

---

## Sincronización programada

Implementada en `src/jobs/scheduler.ts` con [`node-cron`](https://www.npmjs.com/package/node-cron),
registrada en `server.ts` al arrancar el servidor (`registerScheduledJobs`,
job `tracker-weekly-sync`). Expresión cron `0 0 * * 0` (domingo 00:00). Los
errores de la corrida automática se registran en el log del servidor
(`app.log`), no en `AuditLog` (no es una operación que un usuario ejecute ni
que escriba en 3Dtracking).

**Patrón para agregar un job nuevo:** llamar `cron.schedule(expresión, tarea,
{ timezone: SCHEDULER_TIMEZONE, name })` dentro de `registerScheduledJobs()`.

## Integración con 3Dtracking

```
GET /api/v1.0/devices/tracker/list?UserIdGuid=&SessionId= HTTP/1.1
Host: partnerapiv2.3dtracking.net
```

Respuesta (un elemento por tracker físico):

```json
{
  "Status": { "Result": "ok", "ErrorCode": "0", "Message": "ok" },
  "Result": [
    {
      "Uid": "string",
      "Name": "string",
      "IMEI": "string",
      "TrackerTypeUid": "string",
      "TrackerTypeName": "string",
      "UnitModelUid": "string",
      "UnitModelName": "string",
      "SimUid": "string",
      "ActivationCode": "string | null",
      "CreatedDateTimeUtc": "string"
    }
  ]
}
```

Implementado en `Tracking3DClient.getTrackerList`.
