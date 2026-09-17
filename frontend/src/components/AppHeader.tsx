import { NavLink } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/admin/vehiculos", label: "Vehículos" },
  { to: "/admin/trackers", label: "GPS" },
  { to: "/admin/sims", label: "SIMs" },
  { to: "/admin/empresas", label: "Empresas" }
];

const ROOT_ONLY_NAV_ITEMS = [
  { to: "/admin/mensajeria", label: "Mensajería" },
  { to: "/admin/usuarios", label: "Usuarios" }
];

export function AppHeader() {
  const { user, logout } = useAuth();

  const navItems = user?.role === "root"
    ? [...NAV_ITEMS, ...ROOT_ONLY_NAV_ITEMS]
    : NAV_ITEMS;

  return (
    <header className="app-header">
      <div className="app-header-left">
        <div className="app-brand">DADA DADA Fleet</div>

        <nav className="app-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive ? "app-nav-link app-nav-link-active" : "app-nav-link"
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="app-header-right">
        <span className="app-user">{user?.username}</span>
        <button className="btn-secondary" onClick={logout}>
          Cerrar sesión
        </button>
      </div>
    </header>
  );
}
