# Matriz de permisos — Fase 1 (Tickets, Colas, FAQ)

Chatbot Dada Fleet, Fase 1 (análisis/diseño + backend base). Cubre los
endpoints `/api/v1/tickets`, `/api/v1/chat-queues` y `/api/v1/faq`,
implementados y verificados con datos reales el 2026-10-26.

La integración de canal (WhatsApp entrante/salientte vía webhook o
WhatsApp Cloud API) queda deliberadamente **al final** del proyecto —
decisión del usuario, 2026-10-26. Mientras tanto, todas las pruebas de
tickets/FAQ se hacen por **chat local** (módulo interno, pendiente de
UI) y por **API directa** (Postman / checklist QA de 51 endpoints).

## Tickets (`/api/v1/tickets`)

| Acción | root | admin | supervisor | user (agente) | cliente |
|---|---|---|---|---|---|
| Crear ticket (`POST /tickets`) | Sí | Sí | Sí | Sí | Sí |
| Listar — vista por defecto (`GET /tickets`) | Todos | Todos | Los de sus colas | Los asignados a él | Solo los propios |
| Listar — sin reclamar (`?view=unclaimed`) | Todos | Todos | Los de sus colas | Los de sus colas, sin asignar | — (no aplica) |
| Listar — histórico (`?view=historico`) | Todos, orden cronológico asc. | Todos, orden cronológico asc. | Los de sus colas, orden cronológico asc. | Los asignados a él, orden cronológico asc. | Los propios, orden cronológico asc. |
| Ver detalle (`GET /tickets/:id`) | Cualquiera | Cualquiera | Solo si el ticket es de una cola que supervisa | Cualquiera (incluso de otro agente) | Solo si es propio |
| Reclamar (`claim: true`) | — (no aplica, no tiene colas) | — | — (usa `assignedToUserId` directo) | Sí, si está sin reclamar y en su cola | No |
| Liberar (`release: true`) | — | — | — | Sí, si está asignado a él mismo | No |
| Cambiar status/priority/queueId/assignedToUserId | Sí, cualquier campo | Sí, cualquier campo | status/priority/assignedToUserId, solo en sus colas | Solo status, si el ticket está asignado a él mismo | No (403) |
| Eliminar ticket | No existe endpoint | No existe endpoint | No existe endpoint | No existe endpoint | No existe endpoint |

Liberación automática: un ticket asignado en estado `abierto` o
`en_progreso` sin cambios en 24h se libera solo (scheduler,
`src/plugins/chat-ticket-release-scheduler.ts`). Usa `updatedAt` del
ticket como proxy de "última actividad" — no existe todavía un hilo de
mensajes separado (eso es Fase 3); cuando exista, este chequeo debe
mirar el último mensaje, no `updatedAt` del ticket.

## Colas de soporte (`/api/v1/chat-queues`)

| Acción | root | admin | supervisor | user (agente) | cliente |
|---|---|---|---|---|---|
| Listar colas (`GET /chat-queues`) | Sí | Sí | Sí | Sí | Sí |
| Crear cola (`POST /chat-queues`) | Sí | No | No | No | No |
| Eliminar cola | No existe endpoint | No existe endpoint | No existe endpoint | No existe endpoint | No existe endpoint |
| Asignar usuarios a una cola (`queueIds` en `PATCH /admin/users/:id`) | Sí | Sí | No | No | No |

## FAQ (`/api/v1/faq`)

| Acción | root | admin | supervisor | user (agente) | cliente |
|---|---|---|---|---|---|
| Listar (`GET /faq`) | Sí | Sí | Sí | Sí | Sí |
| Crear (`POST /faq`) | Sí | Sí | No | No | No |
| Editar/eliminar | No existe endpoint (pendiente) | No existe endpoint (pendiente) | — | — | — |

## Identidad cliente↔WhatsApp

El vínculo cliente↔número se hace por el campo `User.whatsapp`
(único, obligatorio solo para `role = "cliente"`). El número por sí
solo no es prueba de autorización — la cuenta ya tiene que existir y
estar vinculada antes de que un mensaje entrante se asocie a un
cliente. La verificación real de este vínculo (webhook entrante) se
hace en la fase de integración de canal, no en esta.

## Pendiente, fuera de esta matriz

- `PATCH /faq/:id`, `DELETE /faq/:id`.
- `DELETE` de tickets y de colas.
- UI/frontend para todo lo anterior (módulo aparte del chatbot).
- Decisión sobre webhooks entrantes de DMS SMART vs. WhatsApp Cloud API
  de Meta — diferida a la fase de integración de canal.
- Decisión sobre la fuente de alertas para RF-05 (solo webhook vs.
  también `apiv2.3dtracking.net`, inestable con `ErrorCode 50000`).
