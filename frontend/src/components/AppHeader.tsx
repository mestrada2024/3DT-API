import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";

interface NavItem {
  to: string;
  label: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const FLOTAS_GROUP: NavGroup = {
  label: "Flotas",
  items: [
    { to: "/admin/vehiculos", label: "Vehículos" },
    { to: "/admin/trackers", label: "GPS" },
    { to: "/admin/sims", label: "SIMs" }
  ]
};

const ADMIN_GROUP_ITEMS_BASE: NavItem[] = [
  { to: "/admin/empresas", label: "Empresas" }
];

const ADMIN_GROUP_ITEM_ROOT_ONLY: NavItem = { to: "/admin/usuarios", label: "Usuarios" };

const MENSAJERIA_ITEM: NavItem = { to: "/admin/mensajeria", label: "Mensajería" };

function NavDropdown({ group }: { group: NavGroup }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const rootRef = useRef<HTMLDivElement | null>(null);

  const isGroupActive = group.items.some((item) => location.pathname.startsWith(item.to));

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="app-nav-dropdown" ref={rootRef}>
      <button
        type="button"
        className={isGroupActive ? "app-nav-link app-nav-link-active" : "app-nav-link"}
        onClick={() => setOpen((prev) => !prev)}
      >
        {group.label}
        <span className="app-nav-caret">▾</span>
      </button>

      {open && (
        <div className="app-nav-dropdown-menu">
          {group.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive ? "app-nav-dropdown-link app-nav-dropdown-link-active" : "app-nav-dropdown-link"
              }
              onClick={() => setOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export function AppHeader() {
  const { user, logout } = useAuth();

  const isRoot = user?.role === "root";

  const adminGroup: NavGroup = {
    label: "Administración",
    items: isRoot ? [...ADMIN_GROUP_ITEMS_BASE, ADMIN_GROUP_ITEM_ROOT_ONLY] : ADMIN_GROUP_ITEMS_BASE
  };

  return (
    <header className="app-header">
      <div className="app-header-left">
        <div className="app-brand">DADA DADA Fleet</div>

        <nav className="app-nav">
          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              isActive ? "app-nav-link app-nav-link-active" : "app-nav-link"
            }
          >
            Dashboard
          </NavLink>

          <NavDropdown group={FLOTAS_GROUP} />
          <NavDropdown group={adminGroup} />

          {isRoot && (
            <NavLink
              to={MENSAJERIA_ITEM.to}
              className={({ isActive }) =>
                isActive ? "app-nav-link app-nav-link-active" : "app-nav-link"
              }
            >
              {MENSAJERIA_ITEM.label}
            </NavLink>
          )}
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
