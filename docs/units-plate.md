# Unidades — actualización de placa

`PATCH /api/v1/units/:id/plate` actualiza la placa de una unidad en la base
local y la replica en 3Dtracking (atributo `"Placa"` de esa unidad). Requiere
login previo (ver [Autenticación](auth.md)).

---

## PATCH /api/v1/units/:id/plate

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

Cada llamada (éxito o error de replicación) queda registrada en el log de
auditoría (`AuditLog`, módulo `"units"`, acción `"update-plate"`) — ver
[Auditoría](tracking-sims.md#auditoría).
