# Unidades

Requiere login previo (ver [Autenticación](auth.md)). Todos los endpoints
requieren `Authorization: Bearer <token>`.

**Diferencia clave con SIMs/trackers:** 3Dtracking no tiene ningún endpoint
para **eliminar** unidades, así que `DELETE /api/v1/units/:id` es
puramente local. Crear sí es local+remoto, pero en el orden inverso al de
SIMs/trackers — ver [POST /api/v1/units](#post-apiv1units) abajo.

---

## GET /api/v1/tracking/companies

Lectura **en vivo** (no toca la tabla local) del listado de compañías de
la cuenta — útil para el `companyUid` que exige `POST /api/v1/units` sin
depender de que el catálogo local esté sincronizado.

```bash
curl -s http://localhost:3010/api/v1/tracking/companies \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "success": true,
  "data": [
    { "Uid": "4D5416", "Name": "ABRO DE EL SALVADOR, S.A. DE C.V.", "Status": "Active", "...": "..." }
  ]
}
```

## GET /api/v1/tracking/companies/local

Lista/busca en la tabla local `Company` (mismo patrón que
`TrackerType`/`UnitModel`).

| Parámetro | Notas                                                |
|-----------|---------------------------------------------------------|
| `page`    | Default 1.                                                |
| `limit`   | Default 20, máx 100.                                        |
| `search`  | Busca coincidencia parcial en `uid`, `name`, `country`.      |

```bash
curl -s "http://localhost:3010/api/v1/tracking/companies/local?search=El Salvador" \
  -H "Authorization: Bearer $TOKEN"
```

## POST /api/v1/tracking/companies/sync

Sincroniza la tabla local contra `company/list`. Upsert por `uid`. No es
recurrente/programada.

```bash
curl -s -X POST http://localhost:3010/api/v1/tracking/companies/sync \
  -H "Authorization: Bearer $TOKEN"
```

```json
{ "success": true, "data": { "total": 31, "created": 31, "updated": 0, "errors": 0 } }
```

---

## GET /api/v1/units

Listado local paginado.

### Parámetros (querystring)

| Parámetro  | Notas                                                        |
|------------|------------------------------------------------------------------|
| `page`     | Default 1.                                                        |
| `limit`    | Default 20, máx 100.                                               |
| `active`   | Vestigial: `DELETE` ahora borra la fila de verdad, así que nunca hay inactivas que filtrar. |
| `search`   | Busca coincidencia parcial en `name`, `plate`, `imei`.             |
| `hasPlate` | `true` para solo unidades con placa asignada.                      |

```bash
curl -s "http://localhost:3010/api/v1/units?search=Camion&active=true" \
  -H "Authorization: Bearer $TOKEN"
```

---

## GET /api/v1/units/:id

Busca una unidad por `imei`, `plate`, `externalId` o `name` (coincidencia
exacta contra cualquiera de los cuatro).

```bash
curl -s http://localhost:3010/api/v1/units/350424062572845 \
  -H "Authorization: Bearer $TOKEN"
```

`200` con `{ success, data }`, o `404 UNIT_NOT_FOUND`.

También existe `GET /api/v1/units/imei/:imei` (búsqueda exclusiva por
IMEI).

---

## POST /api/v1/units

Crea una unidad. **A diferencia de SIMs/trackers, aquí se llama primero a
3Dtracking** (`company/{companyUid}/unitcreate`) **y solo si responde bien
se guarda localmente** — el motivo es técnico: la unidad local necesita un
`externalId` real desde el momento en que se crea (no admite `null`), y no
tiene mucho sentido una unidad que exista local pero no en 3Dtracking. Si
3Dtracking falla, no queda nada creado ni local ni remoto.

### Body

| Campo          | Tipo   | Requerido | Notas                                                        |
|-----------------|--------|-----------|------------------------------------------------------------------|
| `companyUid`    | string | Sí        | Ver `GET /api/v1/tracking/companies`.                             |
| `name`          | string | Sí        |                                                                    |
| `groupName`     | string | No        |                                                                    |
| `unitFunction`  | string | No        | `"Personal"` \| `"AssetItem"` \| `"Vehicle"`.                     |
| `trackerUid`    | string | No        | Asigna un tracker ya existente al momento de crear (alternativa a usar `POST /api/v1/units/:id/tracker` después). |

### Ejemplo

```bash
curl -s -X POST http://localhost:3010/api/v1/units \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"companyUid":"4D5416","name":"Camión 12","unitFunction":"Vehicle"}'
```

### Respuesta — 201

```json
{
  "success": true,
  "data": {
    "id": 337,
    "externalId": "227EE5",
    "name": "Camión 12",
    "companyUid": "4D5416",
    "companyName": "ABRO DE EL SALVADOR, S.A. DE C.V.",
    "trackingId": null,
    "imei": null,
    "trackerUid": null,
    "status": "Inactivo",
    "active": true,
    "...": "..."
  }
}
```

Si no se pasa `trackerUid`, la unidad queda sin tracker asignado
(`trackingId`/`imei` en `null`) hasta que se use
`POST /api/v1/units/:id/tracker`.

| Código | Error              | Motivo                                            |
|--------|---------------------|------------------------------------------------------|
| 400    | `INVALID_BODY`      | Falta `companyUid` o `name`.                          |
| 502    | `TRACKING3D_ERROR`  | 3Dtracking rechazó la creación (companyUid/trackerUid inválido, etc.). |

---

## DELETE /api/v1/units/:id

Borrado **físico** — puramente local, porque **3Dtracking no tiene ningún
endpoint para eliminar unidades**. Borra de verdad la fila de la tabla
`Unit` (deja de existir); el registro completo queda solo en el log de
auditoría (`beforeState`). La respuesta siempre trae `tracking3d.synced: false`
explicando por qué no se replicó en 3Dtracking.

**Nota:** el borrado es en cascada sobre el historial de posiciones GPS
de esa unidad (tabla `Position`, `onDelete: Cascade`) — ese historial
**no** se guarda en el log (sería demasiado grande), solo el registro de
la unidad misma.

```bash
curl -s -X DELETE http://localhost:3010/api/v1/units/227EE5 \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "success": true,
  "data": { "...": "...", "deleted": true },
  "tracking3d": { "synced": false, "message": "3Dtracking no tiene un endpoint para eliminar unidades; el borrado es solo local" }
}
```

| Código | Error                | Motivo                                   |
|--------|------------------------|--------------------------------------------|
| 400    | `INVALID_IDENTIFIER`   | `:id` vacío.                                 |
| 404    | `UNIT_NOT_FOUND`       | No existe ninguna unidad con ese identificador. |
| 500    | `INTERNAL_SERVER_ERROR` | Error inesperado.                          |

---

## POST /api/v1/units/:id/tracker

Asigna un tracker a una unidad. El tracker se identifica por `trackerUid`
o `imei` en el body, y debe ya tener `uid` (haberse creado en
3Dtracking). Actualiza local siempre primero — `Unit.trackerUid`/`imei`/
`trackingId` tomados del tracker, y de forma bidireccional
`Tracker.unitUid` — e intenta replicar con `units/assigntracker`.

### Body (uno de los dos)

| Campo        | Notas                          |
|--------------|-----------------------------------|
| `trackerUid` | Busca el tracker local por `uid`.  |
| `imei`       | Busca el tracker local por `imei`. |

### Ejemplo

```bash
curl -s -X POST http://localhost:3010/api/v1/units/227EE5/tracker \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"imei":"999555666777888"}'
```

### Respuesta — 200

```json
{
  "success": true,
  "data": { "...": "...", "trackerUid": "51BB9B", "imei": "999555666777888", "trackingId": "999555666777888" },
  "tracker": { "...": "...", "unitUid": "227EE5" },
  "tracking3d": { "synced": true }
}
```

Verificado contra 3Dtracking real: el `GET /api/v1/tracking/trackers/:uid`
de ese tracker pasa a mostrar la asignación en `UnitAssignments`, con
`StartTimeLocal`/`StartUser` puestos por 3Dtracking.

| Código | Error               | Motivo                                                        |
|--------|----------------------|--------------------------------------------------------------|
| 400    | `INVALID_IDENTIFIER` | `:id` vacío.                                                    |
| 400    | `INVALID_BODY`       | Falta `trackerUid`/`imei`, el tracker no existe, o no tiene `uid`. |
| 404    | `UNIT_NOT_FOUND`     | No existe ninguna unidad con ese identificador.                 |
| 500    | `INTERNAL_SERVER_ERROR` | Error inesperado.                                            |

---

## DELETE /api/v1/units/:id/tracker

Quita el tracker asignado a una unidad. Actualiza local siempre primero
(`Unit.trackerUid`/`imei`/`trackingId` a `null` y, de forma bidireccional,
el `Tracker.unitUid` correspondiente a `null`); intenta replicar con
`units/unassigntracker`.

```bash
curl -s -X DELETE http://localhost:3010/api/v1/units/227EE5/tracker \
  -H "Authorization: Bearer $TOKEN"
```

### Respuesta — 200

```json
{
  "success": true,
  "data": { "...": "...", "trackerUid": null, "imei": null, "trackingId": null },
  "tracker": { "...": "...", "unitUid": null },
  "tracking3d": { "synced": true }
}
```

Verificado contra 3Dtracking real: `UnitAssignments` del tracker queda con
`EndTimeLocal`/`EndUser` cerrados.

| Código | Error               | Motivo                                   |
|--------|----------------------|--------------------------------------------|
| 400    | `INVALID_IDENTIFIER` | `:id` vacío.                                 |
| 400    | `INVALID_BODY`       | La unidad no tiene un tracker asignado.       |
| 404    | `UNIT_NOT_FOUND`     | No existe ninguna unidad con ese identificador. |
| 500    | `INTERNAL_SERVER_ERROR` | Error inesperado.                        |

---

## PATCH /api/v1/units/:id/plate

Actualiza la placa de una unidad en la base local y la replica en
3Dtracking (atributo `"Placa"` de esa unidad).

`:id` acepta `imei`, `plate` (la placa actual), `externalId` o `name` —
cualquiera de los cuatro identifica la unidad (mismo criterio que
`GET /api/v1/units/:id`).

### Body

| Campo   | Tipo            | Requerido | Notas                              |
|---------|-----------------|-----------|--------------------------------------|
| `plate` | string \| null  | Sí (la clave debe existir en el body) | `null` o `""` para quitar la placa. |

### Ejemplo

```bash
curl -s -X PATCH http://localhost:3010/api/v1/units/350424062572845/plate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"plate":"P123ABC"}'
```

### Respuesta — 200

```json
{
  "success": true,
  "data": { "id": 4, "externalId": "1C28AE", "imei": "350424062572845", "plate": "P123ABC", "...": "..." },
  "tracking3d": { "synced": true }
}
```

La placa se guarda en la base local **siempre**, incluso si falla la
réplica en 3Dtracking:

```json
{
  "success": true,
  "data": { "...": "...", "plate": "P123ABC" },
  "tracking3d": { "synced": false, "message": "No se pudo sincronizar con 3Dtracking" }
}
```

También puede fallar de forma "esperada" si esa unidad no tiene el atributo
`"Placa"` configurado del lado de 3Dtracking:

```json
{ "synced": false, "message": "La unidad no tiene el atributo \"Placa\" configurado en 3Dtracking" }
```

| Código | Error                    | Motivo                                      |
|--------|--------------------------|-----------------------------------------------|
| 400    | `INVALID_IDENTIFIER`     | `:id` vacío.                                   |
| 400    | `INVALID_BODY`           | El body no trae la clave `plate`.              |
| 404    | `UNIT_NOT_FOUND`         | No existe ninguna unidad con ese identificador.|
| 500    | `INTERNAL_SERVER_ERROR`  | Error inesperado actualizando la unidad.       |

---

## POST /api/v1/units/sync

Sincroniza todas las unidades desde 3Dtracking hacia la base local
(incluye la placa, leída del atributo `"Placa"` de cada unidad). Ya
existente, sin cambios.

```bash
curl -s -X POST http://localhost:3010/api/v1/units/sync \
  -H "Authorization: Bearer $TOKEN"
```

---

## Auditoría

Todas las escrituras (`create`, `delete`, `assign-tracker`,
`unassign-tracker`, `update-plate`) quedan registradas en `AuditLog`
(módulo `"units"`), con `requestBody`/`beforeState`/`afterState` según
aplique — ver [Auditoría](tracking-sims.md#auditoría).

## Integración con 3Dtracking

```
POST /api/v1.0/company/{Uid}/unitcreate?UserIdGuid=&SessionId=&Name=&GroupName=&UnitFunction=&TrackerUid= HTTP/1.1
Host: partnerapiv2.3dtracking.net
```

Respuesta envuelta `{Status, Result: UnitDetail}` (mismo shape que
`GET Units/{Uid}`). Implementado en `Tracking3DClient.createUnit`.

```
POST /api/v1.0/units/assigntracker?UserIdGuid=&SessionId=&UnitUid=&TrackerUid= HTTP/1.1
POST /api/v1.0/units/unassigntracker?UserIdGuid=&SessionId=&UnitUid=&TrackerUid= HTTP/1.1
Host: partnerapiv2.3dtracking.net
```

Respuesta `{Status, Result: boolean}`. Implementados en
`Tracking3DClient.assignTrackerToUnit` / `unassignTrackerFromUnit`.

```
GET /api/v1.0/company/list?UserIdGuid=&SessionId= HTTP/1.1
Host: partnerapiv2.3dtracking.net
```

Respuesta `{Status, Result: CompanyDetails[]}`. Implementado en
`Tracking3DClient.getCompanyList`.

**No existe** ningún `units/{Uid}/delete` ni equivalente — confirmado
contra el spec OpenAPI oficial
([`partnerapiv2.3dtracking.net/docs/v1/`](https://partnerapiv2.3dtracking.net/docs/v1/),
spec en `openapi/v1.json`).
