import { Navigate, Outlet } from "react-router-dom";

import { useAuth } from "./AuthContext";

/**
 * Como ProtectedRoute, pero además exige rol root — usado para
 * /admin/usuarios. El backend ya lo bloquea igual (requireRoot), esto
 * solo evita mostrar una pantalla vacía/con errores 403 a alguien sin
 * ese rol.
 */
export function RootRoute() {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.role !== "root") {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
