# SIMs — creación individual y por lote

Endpoints para dar de alta, actualizar, eliminar y consultar SIMs.
`iccid` y `phoneNumber` son únicos: antes de crear o actualizar un SIM,
se valida que ninguno de los dos esté ya en uso — tanto en la base
local como **en vivo contra 3Dtracking** (se consulta `Devices/Sim/List`
antes de insertar/actualizar). Si esa consulta a 3Dtracking falla, la
operación se rechaza (no se escribe nada, ni local ni remoto): no se
puede garantizar que no haya duplicado.

Una vez pasada la validación, se guarda primero en la tabla local `Sim`
y, acto seguido, se replica en 3Dtracking (`POST devices/sim/create` /
`update` / `delete`, según la acción). Un fallo al *replicar* (ya
pasada la validación de duplicados) **no** revierte el registro local:
queda guardado con `syncStatus: "error"` y el detalle del fallo en
`syncError`, para reintentar después.

Toda operación de escritura (`POST`/`PATCH`/`DELETE`) queda registrada
en el log de auditoría — ver [Auditoría](#auditoría) más abajo.

Todos los endpoints requieren autenticación:

```
Authorization: Bearer <accessToken>
```

El token se obtiene con `POST /api/v1/auth/login` (ver README).

---

## GET /api/v1/tracking/sims/local

Lista/busca en la tabla **local** `Sim` (a diferencia de `GET /sims`,
que consulta en vivo a 3Dtracking — ver más abajo). Por defecto solo
muestra los SIMs activos.

### Parámetros (querystring)

| Parámetro    | Notas                                                          |
|--------------|-------------------------------------------------------------------|
| `page`       | Default 1.                                                        |
| `limit`      | Default 20, máx 100.                                              |
| `search`     | Busca coincidencia parcial en `iccid`, `phoneNumber`, `trackerUid`.|
| `active`     | `false` para ver los borrados lógicamente. Default: solo activos. |
| `syncStatus` | Filtro exacto: `pending` \| `synced` \| `error` \| `deleted`.      |

### Ejemplo

```bash
curl -s "http://localhost:3010/api/v1/tracking/sims/local?search=8952&syncStatus=error" \
  -H "Authorization: Bearer $TOKEN"
```

### Respuesta — 200

```json
{
  "success": true,
  "data": [ { "...": "..." } ],
  "pagination": { "page": 1, "limit": 20, "total": 3, "pages": 1 }
}
```

---

## GET /api/v1/tracking/sims/local/:id

Busca un SIM local por `iccid` o `externalId` (incluye borrados
lógicamente, a diferencia de `PATCH`/`DELETE`).

```bash
curl -s http://localhost:3010/api/v1/tracking/sims/local/8952140012345678901 \
  -H "Authorization: Bearer $TOKEN"
```

`200` con `{ success, data }`, o `404 SIM_NOT_FOUND`.

---

## POST /api/v1/tracking/sims

Crea un SIM individual.

### Body

| Campo         | Tipo   | Requerido | Notas                                                |
|---------------|--------|-----------|-------------------------------------------------------|
| `iccid`       | string | Sí        | Único (local y en 3Dtracking; se valida antes de insertar). |
| `phoneNumber` | string | No        | Único si se envía (misma validación que `iccid`).      |
| `pin`         | string | No        |                                                         |
| `puk`         | string | No        |                                                         |
| `trackerUid`  | string | No        | Solo se guarda local. 3Dtracking no lo acepta al crear un SIM (ver "Integración con 3Dtracking" abajo). |

### Ejemplo

```bash
curl -s -X POST http://localhost:3010/api/v1/tracking/sims \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "iccid": "8952140012345678901",
        "phoneNumber": "5215512345678",
        "pin": "1234",
        "puk": "12345678"
      }'
```

### Respuestas

**201** — creado local, replicado con éxito en 3Dtracking:

```json
{
  "success": true,
  "data": {
    "id": 1,
    "iccid": "8952140012345678901",
    "phoneNumber": "5215512345678",
    "pin": "1234",
    "puk": "12345678",
    "trackerUid": null,
    "externalId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "syncStatus": "synced",
    "syncError": null,
    "syncedAt": "2026-09-09T19:50:00.000Z",
    "createdAt": "2026-09-09T19:50:00.000Z",
    "updatedAt": "2026-09-09T19:50:00.000Z"
  },
  "tracking3d": { "synced": true }
}
```

**201** — creado local, pero la replicación en 3Dtracking falló (queda
pendiente de reintento; el registro local no se pierde):

```json
{
  "success": true,
  "data": { "...": "...", "syncStatus": "error", "syncError": "3Dtracking devices/sim/create failed: HTTP 400 - ..." },
  "tracking3d": { "synced": false, "message": "3Dtracking devices/sim/create failed: HTTP 400 - ..." }
}
```

| Código | Error                  | Motivo                                   |
|--------|-------------------------|-------------------------------------------|
| 400    | `INVALID_BODY`          | Falta `iccid`.                            |
| 409    | `SIM_ALREADY_EXISTS`    | Ya existe un SIM (local o en 3Dtracking) con ese `iccid` o `phoneNumber`. La respuesta incluye `field` (`"iccid"` \| `"phoneNumber"`) y `source` (`"local"` \| `"3dtracking"`). |
| 500    | `INTERNAL_SERVER_ERROR` | Error inesperado (incluye no poder consultar 3Dtracking para validar duplicados). |

---

## POST /api/v1/tracking/sims/import

Carga masiva. Antes de procesar el lote, se autentica y consulta la
lista de SIMs de 3Dtracking **una sola vez** (no por registro), y esa
lista se va ampliando con cada SIM creado exitosamente — así también
se detectan duplicados dentro del propio lote (dos filas con el mismo
`iccid`, por ejemplo). Si esa consulta inicial a 3Dtracking falla,
se rechaza el lote completo (`502`, nada se guarda). Ya validado,
cada elemento sigue el mismo flujo que la creación individual (guardar
local → replicar en 3Dtracking) de forma independiente: si un registro
falla (duplicado, error de 3Dtracking, etc.), no detiene el resto.

### Body

```json
{
  "sims": [
    { "iccid": "8952140012345678902" },
    { "iccid": "8952140012345678903", "phoneNumber": "5215512345679" }
  ]
}
```

Máximo **500** elementos por request (`TOO_MANY_SIMS` si se excede).

### Ejemplo

```bash
curl -s -X POST http://localhost:3010/api/v1/tracking/sims/import \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sims":[{"iccid":"8952140012345678902"},{"iccid":"8952140012345678903"}]}'
```

### Respuesta — 200

```json
{
  "success": true,
  "data": {
    "total": 2,
    "created": 2,
    "errors": 0,
    "items": [
      { "iccid": "8952140012345678902", "created": true, "synced": true },
      { "iccid": "8952140012345678903", "created": true, "synced": false, "message": "3Dtracking devices/sim/create failed: HTTP 400 - ..." }
    ]
  }
}
```

- `created`: cuántos quedaron guardados en la base local (independiente
  de si se replicaron en 3Dtracking).
- `errors`: cuántos ni siquiera se pudieron guardar en local (ICCID
  vacío o duplicado).
- Cada elemento de `items` indica si se creó localmente (`created`) y si
  se replicó en 3Dtracking (`synced`), con `message` cuando algo falló.

| Código | Error           | Motivo                                              |
|--------|------------------|--------------------------------------------------------|
| 400    | `INVALID_BODY`   | `sims` falta, no es arreglo o está vacío.             |
| 400    | `TOO_MANY_SIMS`  | Más de 500 elementos en el arreglo.                   |
| 502    | `TRACKING3D_ERROR` | No se pudo consultar 3Dtracking para validar el lote (nada se guardó). |

---

## PATCH /api/v1/tracking/sims/:id

Actualiza un SIM. `:id` acepta `iccid` o `externalId`. Antes de
escribir, valida (local + consulta en vivo a 3Dtracking) que el
`phoneNumber` nuevo no esté en uso por otro SIM. Si el SIM ya tiene
`externalId` (fue creado en 3Dtracking), replica el cambio con
`devices/sim/{Uid}/update`; si todavía no lo tiene, solo actualiza local
y lo reporta en `tracking3d.message`.

### Body (todos opcionales, solo se aplican los que se envíen)

| Campo         | Notas                                                        |
|---------------|----------------------------------------------------------------|
| `phoneNumber` |                                                                  |
| `pin`         |                                                                  |
| `puk`         |                                                                  |
| `trackerUid`  | Solo local, no se envía a 3Dtracking (igual que en creación).  |

`iccid` no es editable aquí (es el identificador del SIM).

### Ejemplo

```bash
curl -s -X PATCH http://localhost:3010/api/v1/tracking/sims/8952140012345678901 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"5215599999999"}'
```

### Respuesta — 200

```json
{
  "success": true,
  "data": { "...": "...", "phoneNumber": "5215599999999", "syncStatus": "synced" },
  "tracking3d": { "synced": true }
}
```

| Código | Error           | Motivo                                   |
|--------|------------------|--------------------------------------------|
| 400    | `INVALID_IDENTIFIER` | `:id` vacío.                           |
| 404    | `SIM_NOT_FOUND`  | No existe (o está borrado lógicamente).    |
| 409    | `SIM_ALREADY_EXISTS` | El `phoneNumber` nuevo ya está en uso (local o 3Dtracking) — incluye `field`/`source`. |
| 500    | `INTERNAL_SERVER_ERROR` | Error inesperado.                  |

---

## DELETE /api/v1/tracking/sims/:id

Borrado **lógico** en local: marca el SIM como `active: false` (no se
elimina la fila). Si el SIM ya tenía `externalId` (fue creado en
3Dtracking), además lo elimina allá con `devices/sim/{Uid}/delete`. Si
nunca se sincronizó (sin `externalId`), solo se borra local y se
reporta en `tracking3d.message`. `:id` acepta `iccid` o `externalId`.

### Ejemplo

```bash
curl -s -X DELETE http://localhost:3010/api/v1/tracking/sims/8952140012345678901 \
  -H "Authorization: Bearer $TOKEN"
```

### Respuesta — 200

```json
{
  "success": true,
  "data": { "...": "...", "active": false, "syncStatus": "deleted" },
  "tracking3d": { "synced": true }
}
```

| Código | Error           | Motivo                                   |
|--------|------------------|--------------------------------------------|
| 400    | `INVALID_IDENTIFIER` | `:id` vacío.                           |
| 404    | `SIM_NOT_FOUND`  | No existe o ya estaba borrado.             |
| 500    | `INTERNAL_SERVER_ERROR` | Error inesperado.                  |

Un SIM borrado (`active: false`) deja de poder actualizarse (`PATCH`
responde 404). Su `iccid` **no** queda bloqueado para siempre: si
vuelves a hacer `POST /sims` con ese mismo `iccid`, en vez de crear una
fila nueva se **reactiva** la existente (mismo `id`, se actualizan los
demás campos con los nuevos valores, `active` vuelve a `true` y se
vuelve a intentar crear en 3Dtracking desde cero). La respuesta trae
`"revived": true` en ese caso. Si el `phoneNumber` que se envía
pertenece a otra fila que sigue activa, sí bloquea (`409`) — la
reactivación solo libera el `iccid`/`phoneNumber` que pertenecían a esa
misma fila borrada.

---

## GET /api/v1/tracking/sims

Ya existente, sin relación con la tabla local: consulta en vivo el
listado de SIMs directo desde 3Dtracking (`Devices/Sim/List`). Útil para
confirmar que un SIM creado con los endpoints de arriba ya aparece del
lado de 3Dtracking.

---

## Integración con 3Dtracking

`POST devices/sim/create` — parámetros por **query string** (no hay
body), documentado así:

```
POST /api/v1.0/devices/sim/create?UserIdGuid=&SessionId=&PhoneNumber=&Pin=&PUK=&ICCID= HTTP/1.1
Host: partnerapiv2.3dtracking.net
```

Implementado en `src/integrations/3dtracking/tracking.client.ts`
(`Tracking3DClient.createSim`). No admite `TrackerUid`: ese campo se
guarda solo en la base local (`Sim.trackerUid`), pensado para una
futura asociación SIM↔unidad, pero no se envía en esta llamada.

`POST devices/sim/{Uid}/update` — mismos parámetros por query string,
`{Uid}` es el `externalId` del SIM en 3Dtracking:

```
POST /api/v1.0/devices/sim/{Uid}/update?UserIdGuid=&SessionId=&PhoneNumber=&Pin=&PUK=&ICCID= HTTP/1.1
Host: partnerapiv2.3dtracking.net
```

Implementado en `Tracking3DClient.updateSim`.

`POST devices/sim/{Uid}/delete` — solo requiere autenticación (sin
ICCID/PhoneNumber/etc.), `{Uid}` es el `externalId` del SIM:

```
POST /api/v1.0/devices/sim/{Uid}/delete?UserIdGuid=&SessionId= HTTP/1.1
Host: partnerapiv2.3dtracking.net
```

Implementado en `Tracking3DClient.deleteSim`.

## Modelo de datos (`Sim`)

| Campo         | Notas                                                        |
|---------------|----------------------------------------------------------------|
| `iccid`       | Único. Identificador local y el que se manda a 3Dtracking.     |
| `externalId`  | `Uid` que devuelve 3Dtracking al crear. `null` si aún no sincroniza. |
| `syncStatus`  | `"pending"` (recién creado, sin intento aún — no ocurre en el flujo actual, siempre se intenta al crear), `"synced"`, `"error"`, o `"deleted"` (eliminado con éxito en 3Dtracking). |
| `syncError`   | Último mensaje de error de 3Dtracking, si `syncStatus` es `"error"`. |
| `syncedAt`    | Fecha del último éxito replicando en 3Dtracking (crear, actualizar o eliminar). |
| `active`      | `false` tras un `DELETE` (borrado lógico); `PATCH`/`DELETE` solo encuentran SIMs con `active: true`. |


---

## Auditoría

Toda operación que inserta, actualiza o elimina información en
3Dtracking (no solo SIMs — también `PATCH /api/v1/units/:id/plate`)
queda registrada en la tabla `AuditLog`: quién la ejecutó (`userId` /
`username`, tomados del JWT), en qué módulo/acción, sobre qué recurso,
si tuvo éxito, y un mensaje si algo falló.

| Campo       | Notas                                                    |
|-------------|-------------------------------------------------------------|
| `userId`    | `sub` del JWT (id del usuario).                             |
| `username`  | `username` del JWT.                                         |
| `module`    | `"sims"` \| `"units"`.                                      |
| `action`    | `"create"` \| `"update"` \| `"delete"` \| `"import"` \| `"update-plate"`. |
| `resource`  | Identificador afectado (iccid, id de unidad, o `"N/M creados"` en `import`). |
| `success`   | Si la operación (incluida la replicación en 3Dtracking) tuvo éxito. |
| `message`   | Detalle del error, si `success` es `false`.                  |

No hay todavía un endpoint para consultarlo (solo vía DB directa):

```sql
SELECT * FROM AuditLog ORDER BY createdAt DESC LIMIT 50;
```

**Patrón para endpoints nuevos que escriban en 3Dtracking:** llamar
`logAction()` (en `src/services/audit-log.service.ts`) justo después de
intentar la operación, tanto en éxito como en error, usando
`getActorFromRequest(request)` para obtener el actor. Ver los handlers
de `src/routes/tracking3d.ts` como referencia.
