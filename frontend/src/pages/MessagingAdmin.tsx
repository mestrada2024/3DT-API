import { useCallback, useEffect, useState } from "react";

import { AppHeader } from "../components/AppHeader";
import { ApiError } from "../api/client";
import {
  AlertConfig,
  CriticalAlertTypeRow,
  getAlertConfig,
  listCriticalAlertTypes,
  saveAlertConfig,
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
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={alert.notifyWhatsapp}
                      disabled={savingId === alert.id}
                      onChange={() => handleToggle(alert)}
                    />
                    <span>{alert.notifyWhatsapp ? "Sí" : "No"}</span>
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TemplateSubmodule() {
  const [config, setConfig] = useState<AlertConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [accountId, setAccountId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [templateLabel, setTemplateLabel] = useState("");
  const [templateText, setTemplateText] = useState("");
  const [active, setActive] = useState(false);

  useEffect(() => {
    getAlertConfig()
      .then((response) => {
        const c = response.data;
        setConfig(c);
        setAccountId(c.accountId || "");
        setChannelId(c.channelId || "");
        setTemplateId(c.templateId || "");
        setTemplateLabel(c.templateLabel || "");
        setTemplateText(c.templateText || "");
        setActive(c.active);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaveMessage(null);

    try {
      const response = await saveAlertConfig({
        accountId: accountId.trim() || null,
        channelId: channelId.trim() || null,
        templateId: templateId.trim() || null,
        templateLabel: templateLabel.trim() || null,
        templateText: templateText.trim() || null,
        active
      });
      setConfig(response.data);
      setSaveMessage("Guardado correctamente");
    } catch (err) {
      setSaveMessage(err instanceof ApiError ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="table-empty">Cargando configuración...</div>;
  }

  return (
    <>
      <p className="submodule-help">
        Datos de la plantilla de WhatsApp (DMS SMART) usada para notificar
        alertas críticas. <code>templateId</code> queda pendiente hasta tener
        la plantilla aprobada — mientras esté vacío, el envío automático no
        se activará aunque marques alertas arriba.
      </p>

      {!config?.templateId && (
        <div className="form-warning">
          Falta el <strong>templateId</strong> — pendiente de confirmar con DMS SMART.
        </div>
      )}

      {error && <div className="form-error">{error}</div>}

      <form className="inline-panel" onSubmit={handleSave}>
        <div className="inline-panel-grid">
          <label className="field">
            <span>accountId</span>
            <input value={accountId} onChange={(e) => setAccountId(e.target.value)} />
          </label>
          <label className="field">
            <span>channelId</span>
            <input value={channelId} onChange={(e) => setChannelId(e.target.value)} />
          </label>
          <label className="field">
            <span>templateId</span>
            <input
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              placeholder="Pendiente de DMS SMART"
            />
          </label>
          <label className="field">
            <span>Nombre de la plantilla (referencia)</span>
            <input value={templateLabel} onChange={(e) => setTemplateLabel(e.target.value)} />
          </label>
        </div>

        <label className="field">
          <span>Texto de la plantilla (referencia — {"{{1}}"} se reemplaza con el evento)</span>
          <textarea
            className="template-textarea"
            value={templateText}
            onChange={(e) => setTemplateText(e.target.value)}
            rows={3}
          />
        </label>

        <label className="company-check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Activo (habilita el envío automático — requiere templateId)
        </label>

        {saveMessage && <div className="dashboard-meta">{saveMessage}</div>}

        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? "Guardando..." : "Guardar configuración"}
        </button>
      </form>
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
