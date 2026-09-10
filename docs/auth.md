# Autenticación

Login basado en JWT. El token obtenido aquí (`Authorization: Bearer <token>`)
es el que requieren todos los demás endpoints de la API (`/api/v1/tracking/*`,
`/api/v1/units/*`).

---

## POST /api/v1/auth/login

### Body

| Campo      | Tipo   | Requerido |
|------------|--------|-----------|
| `username` | string | Sí        |
| `password` | string | Sí        |

### Ejemplo

```bash
curl -s -X POST http://localhost:3010/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"tu_password"}'
```

### Respuesta — 200

```json
{
  "success": true,
  "tokenType": "Bearer",
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "id": 1, "username": "admin", "role": "admin" }
}
```

Guarda `accessToken` para usarlo en el resto de las llamadas:

```bash
TOKEN="eyJhbGciOiJIUzI1NiIs..."
curl -s http://localhost:3010/api/v1/tracking/sims/local -H "Authorization: Bearer $TOKEN"
```

El token expira según `JWT_EXPIRES_IN` (`.env`, default `8h`); pasado ese
tiempo hay que volver a hacer login.

| Código | Motivo                                           |
|--------|---------------------------------------------------|
| 400    | Falta `username` o `password`.                    |
| 401    | Usuario no existe o contraseña incorrecta.         |
| 403    | El usuario existe pero está inactivo (`active: false` en la tabla `User`). |

---

## GET /api/v1/auth/me

Devuelve los datos del usuario dueño del token actual — útil para validar
que un token sigue siendo válido, o para saber quién está autenticado sin
tener que decodificar el JWT a mano.

```bash
curl -s http://localhost:3010/api/v1/auth/me -H "Authorization: Bearer $TOKEN"
```

```json
{
  "success": true,
  "user": { "id": 1, "username": "admin", "role": "admin", "active": true }
}
```

---

## Crear/resetear un usuario (fuera de la API, por script)

No hay un endpoint de registro. Los usuarios se crean con un script que corre
dentro del contenedor (`src/scripts/create-admin.ts`) — hace *upsert* por
`username`, así que si el usuario ya existe **le cambia la contraseña**:

```bash
docker exec -e ADMIN_USERNAME=nombre_usuario -e ADMIN_PASSWORD=password_segura \
  dms-api node dist/scripts/create-admin.js
```

Úsalo con cuidado en cuentas que ya estén en uso (`admin`, `TI_DADA`, etc.) —
sobrescribe su contraseña actual. Para pruebas, mejor crear un usuario nuevo
y dedicado y borrarlo al terminar.
