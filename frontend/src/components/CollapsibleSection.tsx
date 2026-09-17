import { useState, type ReactNode } from "react";

const STORAGE_PREFIX = "dms_collapsed_";

function readCollapsed(storageKey: string, defaultCollapsed: boolean): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + storageKey);
    return raw !== null ? raw === "1" : defaultCollapsed;
  } catch {
    return defaultCollapsed;
  }
}

function writeCollapsed(storageKey: string, collapsed: boolean) {
  try {
    localStorage.setItem(STORAGE_PREFIX + storageKey, collapsed ? "1" : "0");
  } catch {
    // per-viewer only; si falla, el estado simplemente no persiste
  }
}

interface CollapsibleSectionProps {
  title: string;
  storageKey: string;
  defaultCollapsed?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  storageKey,
  defaultCollapsed = false,
  children
}: CollapsibleSectionProps) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(storageKey, defaultCollapsed));

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      writeCollapsed(storageKey, next);
      return next;
    });
  }

  return (
    <section className="dash-section">
      <button className="dash-section-header" onClick={toggle}>
        <span className="dash-section-title">{title}</span>
        <span className="dash-section-chevron">{collapsed ? "▸" : "▾"}</span>
      </button>

      {!collapsed && <div className="dash-section-body">{children}</div>}
    </section>
  );
}
