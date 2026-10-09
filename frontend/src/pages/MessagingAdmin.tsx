import { useCallback, useEffect, useState } from "react";

import { AppHeader } from "../components/AppHeader";
import { ApiError } from "../api/client";
import {
  AlertTemplate,
  AlertTemplateBody,
  CriticalAlertTypeRow,
  createAlertTemplate,
  deleteAlertTemplate,
  listAlertTemplates,
  listCriticalAlertTypes,
  updateAlertTemplate,
  updateCriticalAlertType
} from "../api/admin";

type Tab = "alertas" | "plantilla";

function AlertsSubmodule() {
  const [alerts, setAlerts] = useState<CriticalAlertTypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await listCriticalAlertTypes();
      setAlerts(response.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleToggle(alertType: CriticalAlertTypeRow) {
    setSavingId(alertType.id);

    try {
      await updateCriticalAlertType(alertType.id, { notifyWhatsapp: !alertType.notifyWhatsapp });
      setAlerts((prev) =>
        prev.map((a) => (a.id === alertType.id ? { ...a, notifyWhatsapp: !a.notifyWhatsapp } : a))
      );
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : "No se pudo actualizar la alerta");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <>
      <p className="submodule-help">
        Selecciona qué alertas críticas disparan una notificación por WhatsApp
        cuando se detectan (ver módulo Alertas críticas para el catálogo
        completo y el historial de eventos).
      </p>

      {error && <div className="form-error">{error}</div>}

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Alerta</th>
              <th>Descripción</th>
              <th>Señal (SystemName)</th>
              <th>Enviar por WhatsApp</th>
            </tr>
          </thead>
          <tbody>
            {loading && alerts.length === 0 && (
              <tr><td colSpan={4} className="table-empty">Cargando alertas...</td></tr>
            )}

            {alerts.map((alert) => (
              <tr key={alert.id}>
                <td className="unit-name">{alert.name}</td>
                <td>{alert.description || "—"}</td>
                <td>{alert.matchSystemName || "—"}</td>
                <td>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={alert.notifyWhatsapp}
                    className={alert.notifyWhatsapp ? "switch switch-on" : "switch switch-off"}
                    disabled={savingId === alert.id}
                    onClick={() => handleToggle(alert)}
                  >
                    <span className="switch-knob" />
                  </button>
                  <span className="switch-label">{alert.notifyWhatsapp ? "Sí" : "No"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const EMPTY_FORM: AlertTemplateBody = {
  accountId: null,
  channelId: null,
  templateId: null,
  templateLabel: null,
  templateText: null,
  active: false
};

function TemplateSubmodule() {
  const [templates, setTemplates] = useState<AlertTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // null = formulario cerrado, "new" = creando, number = editando ese id
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<AlertTemplateBody>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [actionId, setActionId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await listAlertTemplates();
      setTemplates(response.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setEditing("new");
  }

  function openEdit(template: AlertTemplate) {
    setForm({
      accountId: template.accountId,
      channelId: template.channelId,
      templateId: template.templateId,
      templateLabel: template.templateLabel,
      templateText: template.templateText,
      active: template.active
    });
    setFormError(null);
    setEditing(template.id);
  }

  function closeForm() {
    setEditing(null);
    setFormError(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);

    const body: AlertTemplateBody = {
      accountId: form.accountId?.trim() || null,
      channelId: form.channelId?.trim() || null,
      templateId: form.templateId?.trim() || null,
      templateLabel: form.templateLabel?.trim() || null,
      templateText: form.templateText?.trim() || null,
      active: form.active
    };

    try {
      if (editing === "new") {
        const response = await createAlertTemplate(body);
        setTemplates((prev) => {
          const next = response.data.active ? prev.map((t) => ({ ...t, active: false })) : prev;
          return [...next, response.data];
        });
      } else if (typeof editing === "number") {
        const response = await updateAlertTemplate(editing, body);
        setTemplates((prev) =>
          prev.map((t) => {
            if (t.id === response.data.id) return response.data;
            return response.data.active ? { ...t, active: false } : t;
          })
        );
      }
      setEditing(null);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "No se pudo guardar la plantilla");
    } finally {
      setSaving(false);
    }
  }

  async function handleSetActive(template: AlertTemplate) {
    if (template.active) return;

    setActionId(template.id);

    try {
      const response = await updateAlertTemplate(template.id, { active: true });
      setTemplates((prev) =>
        prev.map((t) => {
          if (t.id === response.data.id) return response.data;
          return { ...t, active: false };
        })
      );
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : "No se pudo marcar como activa");
    } finally {
      setActionId(null);
    }
  }

  async function handleDelete(template: AlertTemplate) {
    if (!window.confirm(`¿Eliminar la plantilla "${template.templateLabel || template.id}"?`)) return;

    setActionId(template.id);

    try {
      await deleteAlertTemplate(template.id);
      setTemplates((prev) => prev.filter((t) => t.id !== template.id));
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : "No se pudo eliminar la plantilla");
    } finally {
      setActionId(null);
    }
  }

  const activeTemplate = templates.find((t) => t.active);

  return (
    <>
      <p className="submodule-help">
        Plantillas de WhatsApp (DMS SMART) disponibles para notificar alertas
        críticas (ver módulo Alertas para elegir qué alertas disparan el
        envío). Solo una plantilla puede estar <strong>activa</strong> a la
        vez — es la que se usa al despachar alertas.
      </p>

      {!activeTemplate && !loading && (
        <div className="form-warning">
          No hay ninguna plantilla activa — el envío automático no funcionará
          hasta marcar una.
        </div>
      )}

      {error && <div className="form-error">{error}</div>}

      {editing === null && (
        <button type="button" className="btn-primary" onClick={openCreate}>
          + Nueva plantilla
        </button>
      )}

      {editing !== null && (
        <form className="inline-panel" onSubmit={handleSubmit}>
          <div className="inline-panel-grid">
            <label className="field">
              <span>accountId</span>
              <input
                value={form.accountId || ""}
                onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>channelId</span>
              <input
                value={form.channelId || ""}
                onChange={(e) => setForm((f) => ({ ...f, channelId: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>templateId</span>
              <input
                value={form.templateId || ""}
                onChange={(e) => setForm((f) => ({ ...f, templateId: e.target.value }))}
                placeholder="Pendiente de DMS SMART"
              />
            </label>
            <label className="field">
              <span>Nombre de la plantilla (referencia)</span>
              <input
                value={form.templateLabel || ""}
                onChange={(e) => setForm((f) => ({ ...f, templateLabel: e.target.value }))}
              />
            </label>
          </div>

          <label className="field">
            <span>Texto de la plantilla (referencia — {"{{1}}"} se reemplaza con el evento)</span>
            <textarea
              className="template-textarea"
              value={form.templateText || ""}
              onChange={(e) => setForm((f) => ({ ...f, templateText: e.target.value }))}
              rows={3}
            />
          </label>

          <label className="company-check">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
            />
            Activa (al guardar, desactiva cualquier otra plantilla — requiere templateId)
          </label>

          {formError && <div className="form-error">{formError}</div>}

          <div className="dashboard-toolbar">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Guardando..." : "Guardar plantilla"}
            </button>
            <button type="button" className="btn-secondary" onClick={closeForm} disabled={saving}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>templateId</th>
              <th>accountId</th>
              <th>channelId</th>
              <th>Activa</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && templates.length === 0 && (
              <tr><td colSpan={6} className="table-empty">Cargando plantillas...</td></tr>
            )}

            {!loading && templates.length === 0 && (
              <tr><td colSpan={6} className="table-empty">No hay plantillas creadas todavía.</td></tr>
            )}

            {templates.map((template) => (
              <tr key={template.id}>
                <td className="unit-name">{template.templateLabel || "—"}</td>
                <td>{template.templateId || "—"}</td>
                <td>{template.accountId || "—"}</td>
                <td>{template.channelId || "—"}</td>
                <td>
                  {template.active ? (
                    <span className="badge badge-online">Activa</span>
                  ) : (
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={actionId === template.id}
                      onClick={() => handleSetActive(template)}
                    >
                      Marcar como activa
                    </button>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={actionId === template.id}
                    onClick={() => openEdit(template)}
                  >
                    Editar
                  </button>
                  {" "}
                  <button
                    type="button"
                    className="btn-danger-text"
                    disabled={actionId === template.id}
                    onClick={() => handleDelete(template)}
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function MessagingAdmin() {
  const [tab, setTab] = useState<Tab>("alertas");

  return (
    <div className="app-shell">
      <AppHeader />

      <main className="app-main">
        <div className="dashboard-toolbar">
          <h1>Mensajería</h1>
        </div>

        <div className="submodule-tabs">
          <button
            className={tab === "alertas" ? "submodule-tab submodule-tab-active" : "submodule-tab"}
            onClick={() => setTab("alertas")}
          >
            Alertas
          </button>
          <button
            className={tab === "plantilla" ? "submodule-tab submodule-tab-active" : "submodule-tab"}
            onClick={() => setTab("plantilla")}
          >
            Plantilla
          </button>
        </div>

        {tab === "alertas" ? <AlertsSubmodule /> : <TemplateSubmodule />}
      </main>
    </div>
  );
}
