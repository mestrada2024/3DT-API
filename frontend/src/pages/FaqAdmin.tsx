import { useCallback, useEffect, useState } from "react";

import { AppHeader } from "../components/AppHeader";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { ChatFaq, createChatFaq, listChatFaq } from "../api/admin";

export function FaqAdmin() {
  const { user } = useAuth();
  const canCreate = user?.role === "root" || user?.role === "admin";

  const [faqs, setFaqs] = useState<ChatFaq[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [category, setCategory] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (searchTerm: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await listChatFaq({ search: searchTerm.trim() || undefined });
      setFaqs(response.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(search);
  }, [search, load]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();

    if (!question.trim() || !answer.trim()) {
      setFormError("Pregunta y respuesta son requeridas");
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      await createChatFaq({
        question: question.trim(),
        answer: answer.trim(),
        category: category.trim() || undefined
      });

      setQuestion("");
      setAnswer("");
      setCategory("");
      setShowForm(false);
      load(search);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "No se pudo crear la pregunta frecuente");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="app-shell">
      <AppHeader />

      <main className="app-main">
        <div className="dashboard-toolbar">
          <h1>Chat interno — FAQ</h1>

          <div className="toolbar-actions">
            <form className="search-form" onSubmit={(e) => { e.preventDefault(); load(search); }}>
              <input
                type="text"
                placeholder="Buscar pregunta frecuente"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button type="submit" className="btn-secondary">Buscar</button>
            </form>

            {canCreate && (
              <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
                {showForm ? "Cancelar" : "+ Nueva pregunta"}
              </button>
            )}
          </div>
        </div>

        {showForm && canCreate && (
          <form className="inline-panel" onSubmit={handleCreate}>
            <label className="field">
              <span>Pregunta *</span>
              <input value={question} onChange={(e) => setQuestion(e.target.value)} autoFocus />
            </label>

            <label className="field">
              <span>Respuesta *</span>
              <textarea
                className="template-textarea"
                rows={3}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
              />
            </label>

            <label className="field">
              <span>Categoría</span>
              <input value={category} onChange={(e) => setCategory(e.target.value)} />
            </label>

            {formError && <div className="form-error">{formError}</div>}

            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Guardando..." : "Crear pregunta"}
            </button>
          </form>
        )}

        {error && <div className="form-error">{error}</div>}

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Pregunta</th>
                <th>Respuesta</th>
                <th>Categoría</th>
                <th>Activa</th>
              </tr>
            </thead>
            <tbody>
              {loading && faqs.length === 0 && (
                <tr><td colSpan={4} className="table-empty">Cargando preguntas frecuentes...</td></tr>
              )}

              {!loading && faqs.length === 0 && !error && (
                <tr><td colSpan={4} className="table-empty">No hay preguntas frecuentes todavía</td></tr>
              )}

              {faqs.map((faq) => (
                <tr key={faq.id}>
                  <td>{faq.question}</td>
                  <td>{faq.answer}</td>
                  <td>{faq.category || "—"}</td>
                  <td>
                    <span className={faq.active ? "badge badge-online" : "badge badge-unknown"}>
                      {faq.active ? "Sí" : "No"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
