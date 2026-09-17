# Mensajería (DMS SMART — campaña saliente)

Servicio para enviar plantillas de WhatsApp a través del endpoint de
campaña saliente de la plataforma **DMS SMART** (documento fuente:
"Documentación Endpoint para envío de mensajes." de DADA & CIA).

> ✅ **Confirmado y verificado end-to-end** contra el sistema real
> (2026-09-17). La ruta documentada en el PDF fuente
> (`{{host}}/core-api/api/message/send` sobre
> `https://dada.dms-smart.cloud`) **no es la correcta** — da `405` (el
> host sin `/backend` es el panel web, no una API) o, con
> `/backend/core-api/...`, se cuelga indefinidamente sin responder
> (problema de infraestructura de ese subdominio en particular). La
> ruta real que sí responde es otro subdominio: **`https://dada-websocket.dms-smart.cloud/api/message/send/`**
> (nótese: sin `core-api`, host `dada-websocket` en vez de `dada`, con
> `/` final). Probado con datos reales (cuenta, canal y plantilla
> reales) — responde en <1s con el cuerpo documentado. Si DMS SMART
> vuelve a cambiar la ruta, el error característico de "host
> equivocado" es `405 Not Allowed` de nginx o una respuesta que se
> cuelga sin límite de tiempo; un `403`/`404`/`400`/`200` estructurado
> confirma que la ruta es correcta.

## Arquitectura

- `src/integrations/dms-messaging/messaging.client.ts` — `DmsMessagingClient`,
  el cliente HTTP puro (Basic Auth, `POST {baseUrl}/api/message/send/`).
- `src/integrations/dms-messaging/messaging.types.ts` — tipos del payload y la respuesta.
- `src/plugins/dms-messaging.ts` — plugin de Fastify que expone el cliente como `app.dmsMessaging`.
- `src/routes/messaging.ts` — `POST /api/v1/messaging/send`, envoltorio delgado con auditoría.

Timeout de 15s en el cliente (`AbortController`) — salvaguarda para
que, si DMS SMART deja de responder otra vez, la petición falle limpio
con `502` en vez de colgarse indefinidamente (pasó durante las
pruebas con el host incorrecto).

## Variables de entorno (`.env`)

| Variable                     | Notas                                                      |
|-------------------------------|-------------------------------------------------------------|
| `DMS_MESSAGING_BASE_URL`      | `https://dada-websocket.dms-smart.cloud` — confirmado y funcionando. |
| `DMS_MESSAGING_USERNAME`      | Usuario para Basic Auth. Configurado: `mauricio.api` (el documento usa `integration.user` como ejemplo genérico). |
| `DMS_MESSAGING_PASSWORD`      | Contraseña para Basic Auth.                                  |

Si falta `DMS_MESSAGING_BASE_URL`, `DMS_MESSAGING_USERNAME` o
`DMS_MESSAGING_PASSWORD`, el plugin lanza un error al arrancar el
servidor (`DmsMessagingClient` valida esto en el constructor).

---

## POST /api/v1/messaging/send

Requiere `Authorization: Bearer <token>` (ver [Autenticación](auth.md)).

### Cuerpo (JSON)

Igual que el documentado por DMS SMART — ver
`Documentacion_endpoint_envio_msj.pdf`, sección 5:

```json
{
  "first_name": "Bryan",
  "second_name": "",
  "third_name": "",
  "last_name": "Garay",
  "last_name2": "",
  "phone": "50379858276",
  "dynamicData": {
    "dui": "12345678-9"
  },
  "accountId": "6514f5452e77d40025c78191",
  "channelId": "6514b8e22e77d40025c813c",
  "templateId": "4U4wIZ0ZZ8Vv950WoLGlWT",
  "templateBody": {
    "1": "Bryan Garay",
    "2": "23/05/2025",
    "3": "03:00pm"
  },
  "botData": {
    "close_ticket_in": 20
  },
  "customEvent": "name of event",
  "closed": false
}
```

Campos requeridos por este endpoint (validados antes de llamar a DMS
SMART): `phone`, `accountId`, `templateId`. El resto son opcionales —
`accountId`/`channelId`/`templateId` **no** tienen un default fijo acá
a propósito: cada llamador decide qué cuenta/canal/plantilla usar
según el caso (ver sección 3 del documento fuente para cómo obtener
`templateId` desde el panel de plantillas de DMS SMART).

### Ejemplo

```bash
curl -s -X POST http://localhost:3010/api/v1/messaging/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Bryan",
    "last_name": "Garay",
    "phone": "50379858276",
    "accountId": "6514f5452e77d40025c78191",
    "channelId": "6514b8e22e77d40025c813c",
    "templateId": "4U4wIZ0ZZ8Vv950WoLGlWT",
    "templateBody": { "1": "Bryan Garay", "2": "23/05/2025", "3": "03:00pm" }
  }'
```

### Respuestas

El endpoint reenvía el `httpStatus` y el cuerpo `{success, message}` /
`{success, error}` tal como los documenta DMS SMART:

| HTTP | Significado (según el documento fuente)                                          |
|------|-------------------------------------------------------------------------------------|
| 200  | Mensaje enviado correctamente.                                                       |
| 400  | Falta el cuerpo de la plantilla (`templateBody`) — la plantilla requiere variables.  |
| 403  | Ya hay una conversación abierta, reclamada por un agente o en calificación.          |
| 404  | No se encontró la plantilla (`templateId` inválido).                                 |
| 500  | Error inesperado del lado de DMS SMART.                                              |

```json
{ "success": true, "message": "Mensaje enviado correctamente!!!" }
```

```json
{ "success": false, "message": "Template not found" }
```

`400 VALIDATION_ERROR` (propio de este API, antes de llamar a DMS
SMART) si falta `phone`, `accountId` o `templateId` en el request.

`502 DMS_MESSAGING_ERROR` si no se pudo conectar con la API de DMS
SMART (host caído, timeout tras 15s, respuesta no-JSON) — el detalle
real queda en los logs del servidor.

### Auditoría

Cada llamada queda registrada en `AuditLog` (`module: "messaging"`,
`action: "send"`, `resource: <phone>`), con el payload enviado y el
resultado — igual que el resto de endpoints de escritura del sistema.
