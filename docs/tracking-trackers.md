# Trackers

Tabla local `Tracker` sincronizada desde 3Dtracking (`GET
devices/tracker/list`) — el inventario real de trackers/GPS físicos de la
cuenta (no confundir con `devices/trackertype/list`, un catálogo aparte que
está vacío en esta cuenta y no se usa aquí).

**No hay sincronización recurrente/programada.** `POST /trackers/sync` es
una carga inicial (o un "resync" manual si hace falta) — de ahí en adelante,
la tabla local se mantiene al día porque cada tracker que se cree (vía el
endpoint de creación — **aún no implementado**, ver abajo) se guarda al
mismo tiempo en local y en 3Dtracking, igual que el módulo de SIMs.

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
| `active`  | Vestigial: `DELETE` ahora borra la fila de verdad, así que nunca hay inactivos que ver con `?active=false`. |

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

## PATCH /api/v1/tracking/trackers/:id

Actualiza un tracker. `:id` acepta `uid` o `imei`. Si se envía un `imei`
nuevo, valida (local + consulta en vivo a 3Dtracking) que no esté ya en
uso. Si el tracker ya tiene `uid` (fue creado en 3Dtracking), replica el
cambio con `devices/tracker/{Uid}/update`; si todavía no lo tiene, solo
actualiza local y lo reporta en `tracking3d.message`. Queda registrado en
el log de auditoría.

### Body (todos opcionales, solo se aplican los que se envíen)

| Campo    | Notas                                                                    |
|----------|------------------------------------------------------------------------------|
| `name`   |                                                                                |
| `imei`   | Único (local y en 3Dtracking).                                               |
| `simUid` |                                                                                |

`trackerTypeUid`/`unitModelUid` no son editables aquí — `devices/tracker/{Uid}/update`
no los admite (solo se pueden fijar al crear).

### Ejemplo

```bash
curl -s -X PATCH http://localhost:3010/api/v1/tracking/trackers/F1DEF6 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Camión 12 (renombrado)"}'
```

### Respuesta — 200

```json
{
  "success": true,
  "data": { "...": "...", "name": "Camión 12 (renombrado)", "syncStatus": "synced" },
  "tracking3d": { "synced": true }
}
```

| Código | Error                    | Motivo                                                          |
|--------|---------------------------|--------------------------------------------------------------------|
| 400    | `INVALID_IDENTIFIER`      | `:id` vacío.                                                        |
| 400    | `INVALID_BODY`            | `imei` enviado vacío/en blanco.                                    |
| 404    | `TRACKER_NOT_FOUND`       | No existe ningún tracker con ese `uid`/`imei`.                     |
| 409    | `TRACKER_ALREADY_EXISTS`  | El `imei` nuevo ya está en uso (local o 3Dtracking) — respuesta incluye `source`. |
| 500    | `INTERNAL_SERVER_ERROR`   | Error inesperado.                                                    |

---

## DELETE /api/v1/tracking/trackers/:id

Borrado **físico**: intenta eliminar primero en 3Dtracking (si el tracker
ya tenía `uid`, con `devices/tracker/{Uid}/delete`) y luego borra de
verdad la fila de la tabla local — deja de existir. El registro completo
y el resultado de la réplica quedan **solo en el log de auditoría**
(`beforeState`). `:id` acepta `uid` o `imei`.

```bash
curl -s -X DELETE http://localhost:3010/api/v1/tracking/trackers/F1DEF6 \
  -H "Authorization: Bearer $TOKEN"
```

### Respuesta — 200

```json
{
  "success": true,
  "data": { "...": "...", "deleted": true },
  "tracking3d": { "synced": true }
}
```

`data` es una copia del registro tal como estaba justo antes de borrarlo
— el respaldo completo y consultable está en `AuditLog.beforeState`.

| Código | Error                | Motivo                                    |
|--------|-----------------------|----------------------------------------------|
| 400    | `INVALID_IDENTIFIER`  | `:id` vacío.                                   |
| 404    | `TRACKER_NOT_FOUND`   | No existe.                                     |
| 500    | `INTERNAL_SERVER_ERROR` | Error inesperado.                          |

Al ser borrado físico, el `imei` queda libre de inmediato: volver a hacer
`POST /trackers` con el mismo `imei` simplemente crea una fila nueva (no
hay reactivación — no hay nada que reactivar, la fila anterior ya no
existe).

---

## POST /api/v1/tracking/trackers/:id/sim

Asigna (o cambia) el SIM de un tracker. El SIM se identifica por `iccid` o
`externalId` (`simUid`) en el body, y debe ya tener `externalId` (haberse
creado en 3Dtracking) — si no, `400`. Actualiza local siempre primero
(`Tracker.simUid` y, de forma bidireccional, `Sim.trackerUid`); si el
tracker ya tiene `uid`, replica el cambio con `devices/tracker/{Uid}/update`
(3Dtracking no tiene un endpoint "allocate" separado — asignar/cambiar SIM
**es** actualizar el tracker con un `SimUid` nuevo). Queda registrado en
el log de auditoría.

### Body (uno de los dos)

| Campo    | Notas                                    |
|----------|----------------------------------------------|
| `iccid`  | Busca el SIM local por ICCID.                 |
| `simUid` | Busca el SIM local por `externalId`.          |

### Ejemplo

```bash
curl -s -X POST http://localhost:3010/api/v1/tracking/trackers/F1DEF6/sim \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"iccid":"8952140012345678903"}'
```

### Respuesta — 200

```json
{
  "success": true,
  "data": { "...": "...", "simUid": "4FCC4C" },
  "sim": { "...": "...", "trackerUid": "F1DEF6" },
  "tracking3d": { "synced": true }
}
```

Verificado contra 3Dtracking real: el `GET /trackers/:uid` de ese tracker
pasa a mostrar la asignación en `SimAssignments`, con `StartTimeLocal`/
`StartUser` puestos por 3Dtracking.

| Código | Error               | Motivo                                                        |
|--------|----------------------|--------------------------------------------------------------|
| 400    | `INVALID_IDENTIFIER` | `:id` vacío.                                                    |
| 400    | `INVALID_BODY`       | Falta `iccid`/`simUid`, el SIM no existe, o no tiene `externalId`. |
| 404    | `TRACKER_NOT_FOUND`  | No existe ningún tracker con ese `uid`/`imei`.                  |
| 500    | `INTERNAL_SERVER_ERROR` | Error inesperado.                                            |

---

## DELETE /api/v1/tracking/trackers/:id/sim

Quita el SIM asignado a un tracker. Actualiza local siempre primero
(`Tracker.simUid` a `null` y, de forma bidireccional, el `Sim.trackerUid`
correspondiente a `null`); si el tracker ya tiene `uid`, replica con el
endpoint dedicado `devices/tracker/{Uid}/deallocatesim` (a diferencia de
poner `SimUid` vacío en un `update`, esto cierra correctamente el registro
de asignación en 3Dtracking — `EndTimeLocal`/`EndUser`, verificado contra
datos reales). Queda registrado en el log de auditoría.

```bash
curl -s -X DELETE http://localhost:3010/api/v1/tracking/trackers/F1DEF6/sim \
  -H "Authorization: Bearer $TOKEN"
```

### Respuesta — 200

```json
{
  "success": true,
  "data": { "...": "...", "simUid": null },
  "sim": { "...": "...", "trackerUid": null },
  "tracking3d": { "synced": true }
}
```

| Código | Error               | Motivo                                    |
|--------|----------------------|------------------------------------------|
| 400    | `INVALID_IDENTIFIER` | `:id` vacío.                                |
| 400    | `INVALID_BODY`       | El tracker no tiene un SIM asignado.        |
| 404    | `TRACKER_NOT_FOUND`  | No existe ningún tracker con ese `uid`/`imei`. |
| 500    | `INTERNAL_SERVER_ERROR` | Error inesperado.                        |

---

## POST /api/v1/tracking/trackers/sync

Fuerza una sincronización completa contra `devices/tracker/list` (upsert por
`uid`). Pensado como carga inicial única — una vez poblada la tabla, las
altas nuevas deberían entrar por el endpoint de creación (pendiente, ver
abajo), no repitiendo este sync completo.

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

## GET /api/v1/tracking/trackers/:uid

Busca un tracker **en vivo** directo en 3Dtracking por su `uid` (no lee la
tabla local) — trae el detalle completo: asignaciones a unidades
(`UnitAssignments`), asignaciones de SIM (`SimAssignments`) e histórico de
atributos (`Attributes`).

```bash
curl -s http://localhost:3010/api/v1/tracking/trackers/F1DEF6 \
  -H "Authorization: Bearer $TOKEN"
```

### Respuesta — 200

```json
{
  "success": true,
  "data": {
    "Uid": "F1DEF6",
    "Name": "354762116908317",
    "IMEI": "354762116908317",
    "TrackerTypeUid": "UT127",
    "TrackerTypeName": "ATrack",
    "UnitModelUid": "UM89",
    "UnitModelName": "AK7(S)",
    "SimUid": "EF08AB",
    "ActivationCode": "",
    "CreatedDateTimeUtc": "2026-07-30T18:07:30.24",
    "UnitAssignments": [
      { "UnitUid": "D77B5F", "UnitName": "P976510", "StartTimeLocal": "...", "StartUser": "...", "EndTimeLocal": null, "EndUser": null }
    ],
    "SimAssignments": [
      { "SimUid": "EF08AB", "PhoneNumber": "895030122101217732", "StartTimeLocal": "...", "StartUser": "...", "EndTimeLocal": null, "EndUser": null }
    ],
    "Attributes": [
      { "AttributeId": 8987186, "Name": "Número de Sim", "Group": "Tracker - System Info (Readonly)", "DataType": "Texto", "Value": null, "...": "..." }
    ]
  }
}
```

| Código | Error               | Motivo                                                        |
|--------|----------------------|------------------------------------------------------------------|
| 400    | `INVALID_IDENTIFIER` | `:uid` vacío.                                                     |
| 404    | `TRACKER_NOT_FOUND`  | 3Dtracking no tiene un tracker con ese uid (nota abajo).          |
| 502    | `TRACKING3D_ERROR`   | No se pudo consultar 3Dtracking.                                  |

**Nota:** 3Dtracking responde `HTTP 200` con un `Result` "vacío" (todos los
campos en `null`, incluido `Uid`) cuando el uid no existe, en vez de un 404
real — `Tracking3DClient.getTrackerDetail` lo detecta (`Result.Uid` nulo) y
lo traduce a `404` para quien consuma este endpoint.

---

## POST /api/v1/tracking/trackers

Crea un tracker. **Solo recibe `imei` y `unitModelName`** — todo lo demás
se resuelve solo:

- `name` se fija automáticamente igual al `imei`.
- `trackerTypeUid` y `unitModelUid` se resuelven buscando `unitModelName`
  en la tabla local `UnitModel` (ver [Modelos de unidad](#modelos-de-unidad-unitmodel)
  más abajo) — `TrackerTypeUid` es obligatorio para 3Dtracking
  (`ErrorCode 51121` si falta), por eso el catálogo debe estar
  sincronizado (`POST /unitmodels/sync`) antes de poder crear.

Antes de escribir nada, valida (local + consulta en vivo a 3Dtracking) que
el `imei` no esté ya en uso. Si pasa la validación, se guarda en la base
local y luego se replica en 3Dtracking (`devices/tracker/create`). Si la
replicación falla, el tracker queda creado localmente con
`syncStatus: "error"` (ver `tracking3d` en la respuesta). Queda registrado
en el log de auditoría.

### Body

| Campo           | Tipo   | Requerido | Notas                                                        |
|------------------|--------|-----------|-----------------------------------------------------------------|
| `imei`           | string | Sí        | Único (local y en 3Dtracking; se valida antes de insertar).     |
| `unitModelName`  | string | Sí        | Debe existir en la tabla local `UnitModel` (columna `name`).    |

### Ejemplo

```bash
curl -s -X POST http://localhost:3010/api/v1/tracking/trackers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"imei":"354762116999999","unitModelName":"AK7(S)"}'
```

### Respuesta — 201

```json
{
  "success": true,
  "data": {
    "id": 361,
    "uid": "4CB581",
    "name": "354762116999999",
    "imei": "354762116999999",
    "trackerTypeUid": "UT127",
    "trackerTypeName": "ATrack",
    "unitModelUid": "UM89",
    "unitModelName": "AK7(S)",
    "simUid": null,
    "activationCode": null,
    "createdDateTimeUtc": "...",
    "syncStatus": "synced",
    "syncError": null,
    "syncedAt": "..."
  },
  "tracking3d": { "synced": true }
}
```

| Código | Error                    | Motivo                                                          |
|--------|---------------------------|--------------------------------------------------------------------|
| 400    | `INVALID_BODY`            | Falta `imei` o `unitModelName`.                                     |
| 400    | `UNIT_MODEL_NOT_FOUND`    | `unitModelName` no existe en el catálogo local (sincronizarlo o revisar el nombre). |
| 409    | `TRACKER_ALREADY_EXISTS`  | Ya existe un tracker (local o en 3Dtracking) con ese `imei` — respuesta incluye `source` (`"local"` \| `"3dtracking"`). |
| 500    | `INTERNAL_SERVER_ERROR`   | Error inesperado (incluye no poder consultar 3Dtracking para validar duplicados). |

---

## Tipos de GPS (`TrackerType`)

Catálogo local de tipos de GPS/tracker (`UT127` → `ATrack`, `UT95` → `DCT
Syrus 3G / BT`, etc.). El endpoint dedicado de 3Dtracking
(`devices/trackertype/list`) devuelve un catálogo **vacío** en esta cuenta,
así que la sincronización deriva los tipos de los valores
`TrackerTypeUid`/`TrackerTypeName` presentes en `devices/tracker/list` (la
lista real de trackers), consultada en vivo cada vez que se sincroniza —
no depende de la tabla local `Tracker` estar actualizada.

### GET /api/v1/tracking/trackertypes/local

```bash
curl -s "http://localhost:3010/api/v1/tracking/trackertypes/local?search=Teltonika" \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "success": true,
  "data": [ { "id": 2, "uid": "UT145", "name": "Teltonika FMB9xx", "...": "..." } ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "pages": 1 }
}
```

### POST /api/v1/tracking/trackertypes/sync

```bash
curl -s -X POST http://localhost:3010/api/v1/tracking/trackertypes/sync \
  -H "Authorization: Bearer $TOKEN"
```

```json
{ "success": true, "data": { "total": 26, "created": 26, "updated": 0, "errors": 0 } }
```

`502 TRACKING3D_SYNC_ERROR` si no se pudo consultar 3Dtracking. No es
recurrente/programada (igual que `POST /trackers/sync`) — se puede volver a
correr cuando haga falta refrescar el catálogo.

---

## Modelos de unidad (`UnitModel`)

Catálogo local de modelos (`UM89` → `AK7(S)`, `UM321` → `FMB965`, etc.),
cada uno vinculado a su `trackerTypeUid`/`trackerTypeName`. Se usa para
resolver `POST /trackers` (arriba) a partir de `unitModelName`. Igual que
`TrackerType`, se deriva de `devices/tracker/list` (no hay catálogo
dedicado en 3Dtracking), consultado en vivo cada vez que se sincroniza.
Confirmado con los datos reales: los 31 `unitModelName` de esta cuenta
mapean cada uno a un solo `trackerType`, sin ambigüedad.

### GET /api/v1/tracking/unitmodels/local

```bash
curl -s "http://localhost:3010/api/v1/tracking/unitmodels/local?search=AK7" \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "success": true,
  "data": [ { "id": 4, "uid": "UM89", "name": "AK7(S)", "trackerTypeUid": "UT127", "trackerTypeName": "ATrack", "...": "..." } ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "pages": 1 }
}
```

### POST /api/v1/tracking/unitmodels/sync

```bash
curl -s -X POST http://localhost:3010/api/v1/tracking/unitmodels/sync \
  -H "Authorization: Bearer $TOKEN"
```

```json
{ "success": true, "data": { "total": 31, "created": 31, "updated": 0, "errors": 0 } }
```

`502 TRACKING3D_SYNC_ERROR` si no se pudo consultar 3Dtracking. No es
recurrente/programada — correrla de nuevo cuando aparezcan modelos nuevos
en 3Dtracking (por ejemplo, antes de crear un tracker con un modelo que
`POST /trackers` no reconozca).

---

## Plantilla de configuración por modelo (`TrackerConfigTemplate`)

Cada tracker trae un set fijo de `Attributes` (mismos nombres en todos los
modelos — confirmado contra datos reales; solo 6 son editables:
`Nombre de Usuario`, `Contraseña`, `Puerto de Mensaje Saliente`,
`IP Enrutamiento`, `Puerto de  Enrutamiento`, `IP Dispositivo`; el resto
son de solo lectura). El `AttributeId` de cada uno es propio de cada
tracker individual, no del modelo — por eso aplicar una plantilla siempre
implica primero buscar el atributo por **nombre** en el detalle en vivo de
ese tracker puntual (mismo mecanismo que ya usa `PATCH /units/:id/plate`
con el atributo "Placa").

La plantilla se agrupa por **modelo exacto** (`unitModelUid`), no por
marca/protocolo. Los valores no se infieren de nada — ningún tracker de
esta cuenta tenía estos atributos configurados al momento de construir
esto, así que hay que cargarlos a mano.

### GET /api/v1/tracking/unitmodels/:uid/config-template

```bash
curl -s http://localhost:3010/api/v1/tracking/unitmodels/UM89/config-template \
  -H "Authorization: Bearer $TOKEN"
```

`200` con `{ success, data: { unitModelUid, unitModelName, attributes: [{name, value}] } }`,
o `404 CONFIG_TEMPLATE_NOT_FOUND` si el modelo no tiene plantilla todavía.

### PUT /api/v1/tracking/unitmodels/:uid/config-template

Crea/reemplaza **por completo** la plantilla de un modelo (`:uid` debe
existir en `UnitModel`, ver `GET /api/v1/tracking/unitmodels/local`).

```json
{
  "attributes": {
    "Nombre de Usuario": "usuario_ejemplo",
    "Contraseña": "clave_ejemplo",
    "Puerto de Mensaje Saliente": "5001",
    "IP Enrutamiento": "",
    "Puerto de  Enrutamiento": "",
    "IP Dispositivo": ""
  }
}
```

Si se omite `attributes` (o se manda `{}`), se seedea con los 6 nombres
conocidos y valor vacío — útil para crear la plantilla primero y
completarla con otro `PUT` después. Un atributo con valor vacío/`null` se
guarda pero **no se aplica** al crear un tracker (se omite, no se manda
`""` a 3Dtracking).

```bash
curl -s -X PUT http://localhost:3010/api/v1/tracking/unitmodels/UM89/config-template \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"attributes":{"Nombre de Usuario":"admin","Contraseña":"secreta123"}}'
```

`404 UNIT_MODEL_NOT_FOUND` si `:uid` no existe en el catálogo local.

### Aplicación automática — POST /api/v1/tracking/trackers

Después de crear y replicar un tracker con éxito, si su `unitModelUid`
tiene una plantilla con al menos un valor definido, se aplica
automáticamente (`devices/tracker/{Uid}/attributes/update`). El resultado
viene en `configTemplate` dentro de la respuesta:

```json
{
  "success": true,
  "data": { "...": "..." },
  "tracking3d": { "synced": true },
  "configTemplate": {
    "applied": true,
    "appliedAttributes": ["Nombre de Usuario", "Contraseña", "Puerto de Mensaje Saliente"],
    "skippedAttributes": []
  }
}
```

`applied: false` con un `message` explicando por qué (sin plantilla, sin
valores definidos, la replicación en 3Dtracking falló, etc.) — nunca
bloquea la creación del tracker.

### POST /api/v1/tracking/trackers/:id/capture-config-template

Simula la opción **"Copiar configuración de la Unidad"** del panel de
3Dtracking: en vez de escribir los valores a mano, lee los atributos
configurables que **ya tiene establecidos** un tracker real (`:id`, acepta
`uid` o `imei`) y los guarda como la plantilla del modelo de ese tracker.
Útil cuando ya hay una unidad funcionando correctamente y se quiere que
los siguientes trackers del mismo modelo salgan configurados igual, sin
necesidad de saber los valores de antemano.

```bash
curl -s -X POST http://localhost:3010/api/v1/tracking/trackers/C94063/capture-config-template \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "success": true,
  "data": { "unitModelUid": "UM89", "unitModelName": "AK7(S)", "attributes": [ { "name": "Nombre de Usuario", "value": "..." } ] },
  "sourceTrackerUid": "C94063",
  "capturedAttributes": ["Nombre de Usuario", "Contraseña", "IP Dispositivo"]
}
```

Solo captura los atributos configurables que el tracker de origen tiene
con valor no vacío (ignora los de solo lectura y los que están en blanco).

| Código | Error         | Motivo                                                        |
|--------|----------------|--------------------------------------------------------------|
| 400    | `INVALID_BODY` | Tracker de origen no encontrado, sin `uid`, sin `unitModelUid`, o sin ningún atributo configurado para copiar. |
| 500    | `INTERNAL_SERVER_ERROR` | Error inesperado.                                    |

### POST /api/v1/tracking/trackers/:id/copy-config

Misma idea, pero **tracker a tracker directo**, sin pasar por la
plantilla: copia los atributos configurables del tracker de origen
(`:id`) al tracker destino (`targetUid` o `targetImei` en el body) —
funciona aunque sean de modelos distintos.

```bash
curl -s -X POST http://localhost:3010/api/v1/tracking/trackers/C94063/copy-config \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"targetUid":"C94072"}'
```

```json
{
  "success": true,
  "data": {
    "sourceTrackerUid": "C94063",
    "targetTrackerUid": "C94072",
    "result": { "applied": true, "appliedAttributes": ["Nombre de Usuario", "Contraseña", "IP Dispositivo"], "skippedAttributes": [] }
  }
}
```

| Código | Error         | Motivo                                                        |
|--------|----------------|--------------------------------------------------------------|
| 400    | `INVALID_BODY` | Falta `targetUid`/`targetImei`, origen/destino no encontrado, sin `uid`, o el origen no tiene atributos configurados. |
| 500    | `INTERNAL_SERVER_ERROR` | Error inesperado.                                    |

Ambos endpoints probados contra 3Dtracking real: configuré un tracker
"fuente" manualmente, capturé su plantilla, confirmé que un tracker nuevo
del mismo modelo la recibió automáticamente al crearse, y confirmé que
`copy-config` replica los valores directo a otro tracker de un modelo
distinto.

### POST /api/v1/tracking/trackers/:id/apply-config

Re-aplica manualmente la plantilla del modelo de un tracker ya existente
(`:id` acepta `uid` o `imei`) — útil para trackers creados antes de que
existiera la plantilla, o para reintentar después de editarla.

```bash
curl -s -X POST http://localhost:3010/api/v1/tracking/trackers/F1DEF6/apply-config \
  -H "Authorization: Bearer $TOKEN"
```

Misma forma de respuesta que el campo `configTemplate` de arriba.

| Código | Error               | Motivo                                   |
|--------|----------------------|--------------------------------------------|
| 400    | `INVALID_IDENTIFIER` | `:id` vacío.                                 |
| 400    | `INVALID_BODY`       | El tracker no tiene `uid` (nunca se creó en 3Dtracking). |
| 404    | `TRACKER_NOT_FOUND`  | No existe ningún tracker con ese `uid`/`imei`. |
| 500    | `INTERNAL_SERVER_ERROR` | Error inesperado.                        |

Verificado contra 3Dtracking real: los valores quedaron guardados en el
tracker (confirmado leyendo de vuelta `GET /trackers/:uid`).

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

```
GET /api/v1.0/devices/tracker/{Uid}/get?UserIdGuid=&SessionId= HTTP/1.1
Host: partnerapiv2.3dtracking.net
```

Detalle de un tracker puntual, con `UnitAssignments`, `SimAssignments` y
`Attributes` anidados. Implementado en `Tracking3DClient.getTrackerDetail`.

```
POST /api/v1.0/devices/tracker/create?UserIdGuid=&SessionId=&Name=&IMEI=&TrackerTypeUid=&UnitModelUid=&SimUid= HTTP/1.1
Host: partnerapiv2.3dtracking.net
```

`IMEI` y `TrackerTypeUid` son obligatorios (confirmado por prueba real:
`ErrorCode 51121 "TrackerTypeUid is required"` si falta). Devuelve el
detalle completo del tracker creado (mismo shape que el `get`).
Implementado en `Tracking3DClient.createTracker`.

```
POST /api/v1.0/devices/tracker/{Uid}/update?UserIdGuid=&SessionId=&Name=&IMEI=&SimUid= HTTP/1.1
Host: partnerapiv2.3dtracking.net
```

Solo admite `Name`/`IMEI`/`SimUid` (no `TrackerTypeUid`/`UnitModelUid`). A
diferencia de todos los demás endpoints, la respuesta **no** viene envuelta
en `{ Status, Result }`: es directamente `{ Result, ErrorCode, Message }`
(sin datos del tracker) — `Result` es `"ok"` en éxito. Implementado en
`Tracking3DClient.updateTracker`.

```
POST /api/v1.0/devices/tracker/{Uid}/delete?UserIdGuid=&SessionId= HTTP/1.1
Host: partnerapiv2.3dtracking.net
```

Misma respuesta plana que `update` (`Result`/`ErrorCode`/`Message`, sin
envoltura `Status`). Implementado en `Tracking3DClient.deleteTracker`.

```
POST /api/v1.0/devices/tracker/{Uid}/deallocatesim?UserIdGuid=&SessionId=&SimUid= HTTP/1.1
Host: partnerapiv2.3dtracking.net
```

Misma respuesta plana. No hay un endpoint "allocate" separado: asignar o
cambiar el SIM de un tracker es un `update` normal con `SimUid` nuevo (ver
doc oficial: [`partnerapiv2.3dtracking.net/docs/v1/`](https://partnerapiv2.3dtracking.net/docs/v1/),
spec en `openapi/v1.json`). Implementado en
`Tracking3DClient.deallocateSimFromTracker`.

```
POST /api/v1.0/devices/tracker/{Uid}/attributes/update?UserIdGuid=&SessionId= HTTP/1.1
Content-Type: application/json
Host: partnerapiv2.3dtracking.net

[ { "AttributeId": 8986529, "Value": "usuario_ejemplo" }, ... ]
```

Body es un arreglo (a diferencia de `Units/{Uid}/Attributes/Update`, que
también acepta arreglo pero nosotros solo mandábamos uno; aquí sí se
manda más de uno a la vez). Misma respuesta plana `{Result, ErrorCode,
Message}`. Implementado en `Tracking3DClient.updateTrackerAttributes`.
