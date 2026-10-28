import { Navigate, Outlet } from "react-router-dom";

import { useAuth } from "./AuthContext";

/**
 * Bloquea una pantalla para ciertos roles (ej. "cliente" no ve FAQ ni
 * Administración, pedido 2026-10-26). Se usa dentro de
 * ProtectedRoute, así que acá ya hay sesión; el backend aplica la
 * misma regla, esto solo evita una pantalla vacía o con 403.
 */
export function DenyRoleRoute({ roles }: { roles: string[] }) {
  const { user } = useAuth();

  if (user && roles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
