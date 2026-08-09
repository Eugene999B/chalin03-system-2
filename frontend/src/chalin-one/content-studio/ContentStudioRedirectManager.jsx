import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { contentStudioErrorMessage } from "./contentStudioApi";
import {
  activateRedirectRule,
  archiveRedirectRule,
  createRedirectDraft,
  deactivateRedirectRule,
  listRedirectRules,
  updateRedirectDraft,
} from "./contentStudioRedirectApi";
import "./contentStudioRedirectManager.css";

const EMPTY_FORM = Object.freeze({
  source_path: "",
  destination_url: "",
  redirect_status: "301",
  activate_at: "",
  expires_at: "",
  reason: "",
});

function localDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function payloadFromForm(form) {
  return {
    source_path: form.source_path.trim(),
    destination_url: form.destination_url.trim(),
    redirect_status: Number(form.redirect_status),
    activate_at: form.activate_at ? new Date(form.activate_at).toISOString() : null,
    expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
    reason: form.reason.trim(),
  };
}

function statusLabel(value) {
  return String(value || "draft").replaceAll("_", " ");
}

export default function ContentStudioRedirectManager() {
  const auth = useAuth();
  const canManage = auth.hasPermission("public_navigation.manage");
  const canPublish = auth.hasPermission("public_content.publish");
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async ({ signal } = {}) => {
    setLoading(true);
    setError("");
    try {
      const result = await listRedirectRules({ signal });
      if (!signal?.aborted) setItems(Array.isArray(result?.items) ? result.items : []);
    } catch (loadError) {
      if (!signal?.aborted) setError(contentStudioErrorMessage(loadError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load({ signal: controller.signal });
    return () => controller.abort();
  }, [load]);

  const counts = useMemo(
    () =>
      items.reduce(
        (result, item) => {
          const key = String(item.rule_status || "draft");
          if (Object.hasOwn(result, key)) result[key] += 1;
          result.total += 1;
          return result;
        },
        { total: 0, active: 0, draft: 0, inactive: 0, archived: 0 }
      ),
    [items]
  );

  function resetForm() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
  }

  function editRule(rule) {
    if (!canManage || !["draft", "inactive"].includes(rule.rule_status)) return;
    setEditingId(Number(rule.id));
    setForm({
      source_path: rule.source_path || "",
      destination_url: rule.destination_url || "",
      redirect_status: String(rule.redirect_status || 301),
      activate_at: localDateTime(rule.activate_at),
      expires_at: localDateTime(rule.expires_at),
      reason: rule.reason || "",
    });
    setNotice("");
    setError("");
  }

  async function submit(event) {
    event.preventDefault();
    if (!canManage || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = payloadFromForm(form);
      const result = editingId
        ? await updateRedirectDraft(editingId, payload)
        : await createRedirectDraft(payload);
      setItems(Array.isArray(result?.items) ? result.items : []);
      setNotice(editingId ? "Redirect draft updated safely." : "Redirect draft created. A Publisher must activate it.");
      resetForm();
    } catch (saveError) {
      setError(contentStudioErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function runAction(rule, action) {
    if (busyId) return;
    setBusyId(Number(rule.id));
    setError("");
    setNotice("");
    try {
      let result;
      if (action === "activate") result = await activateRedirectRule(rule.id);
      if (action === "deactivate") result = await deactivateRedirectRule(rule.id);
      if (action === "archive") result = await archiveRedirectRule(rule.id, rule.reason || "Retired in Redirect Manager");
      setItems(Array.isArray(result?.items) ? result.items : []);
      setNotice(`Redirect ${action} action completed.`);
      if (editingId === Number(rule.id)) resetForm();
    } catch (actionError) {
      setError(contentStudioErrorMessage(actionError));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="cs-redirect-manager">
      <header className="cs-redirect-hero">
        <div>
          <span>WEBSITE / URL GOVERNANCE</span>
          <h1>Redirect Manager</h1>
          <p>Prepare exact public URL moves without hidden route rewrites. Editors create safe drafts; Publishers activate or stop redirects.</p>
        </div>
        <div className="cs-redirect-scoreboard" aria-label="Redirect rule summary">
          <article><strong>{counts.active}</strong><span>Active</span></article>
          <article><strong>{counts.draft}</strong><span>Draft</span></article>
          <article><strong>{counts.inactive}</strong><span>Inactive</span></article>
          <article><strong>{counts.total}</strong><span>Total</span></article>
        </div>
      </header>

      <div className="cs-redirect-safety">
        <strong>Safety engine</strong>
        <span>Exact source paths only</span>
        <span>HTTPS external destinations</span>
        <span>301 · 302 · 307 · 308 only</span>
        <span>No active-page collisions</span>
        <span>No loops or redirect chains</span>
      </div>

      {error ? <div className="cs-redirect-message is-error" role="alert">{error}</div> : null}
      {notice ? <div className="cs-redirect-message is-success" role="status">{notice}</div> : null}

      <div className="cs-redirect-layout">
        <form className="cs-redirect-form" onSubmit={submit}>
          <div className="cs-redirect-form-heading">
            <div><span>{editingId ? "EDIT DRAFT" : "NEW RULE"}</span><h2>{editingId ? "Update redirect draft" : "Prepare a redirect"}</h2></div>
            {editingId ? <button type="button" onClick={resetForm}>Cancel edit</button> : null}
          </div>

          <label>
            <span>Exact old path</span>
            <input disabled={!canManage} required placeholder="/old-company-page" value={form.source_path} onChange={(event) => setForm((current) => ({ ...current, source_path: event.target.value }))} />
            <small>No domain, query string or fragment.</small>
          </label>
          <label>
            <span>Destination</span>
            <input disabled={!canManage} required placeholder="/about or https://trusted.example/..." value={form.destination_url} onChange={(event) => setForm((current) => ({ ...current, destination_url: event.target.value }))} />
          </label>
          <div className="cs-redirect-form-grid">
            <label>
              <span>Status code</span>
              <select disabled={!canManage} value={form.redirect_status} onChange={(event) => setForm((current) => ({ ...current, redirect_status: event.target.value }))}>
                <option value="301">301 · Permanent</option>
                <option value="302">302 · Temporary</option>
                <option value="307">307 · Temporary, preserve method</option>
                <option value="308">308 · Permanent, preserve method</option>
              </select>
            </label>
            <label><span>Activation time</span><input disabled={!canManage} type="datetime-local" value={form.activate_at} onChange={(event) => setForm((current) => ({ ...current, activate_at: event.target.value }))} /></label>
            <label><span>Expiry time</span><input disabled={!canManage} type="datetime-local" value={form.expires_at} onChange={(event) => setForm((current) => ({ ...current, expires_at: event.target.value }))} /></label>
          </div>
          <label>
            <span>Reason / change note</span>
            <textarea disabled={!canManage} rows="3" maxLength="500" value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Why is this URL moving?" />
          </label>
          <button className="cs-button cs-button-primary" disabled={!canManage || saving} type="submit">
            {saving ? "Checking safety…" : editingId ? "Save safe draft" : "Create redirect draft"}
          </button>
          {!canManage ? <p className="cs-redirect-readonly">Your Studio role can view redirects but cannot edit them.</p> : null}
        </form>

        <div className="cs-redirect-list">
          <div className="cs-redirect-list-heading"><div><span>GOVERNED RULES</span><h2>Redirect registry</h2></div><button type="button" onClick={() => load()} disabled={loading}>Refresh</button></div>
          {loading ? <div className="cs-redirect-empty">Loading governed redirects…</div> : items.length === 0 ? <div className="cs-redirect-empty"><strong>No redirect rules yet.</strong><span>The public website continues using its normal route map.</span></div> : items.map((rule) => (
            <article className="cs-redirect-rule" key={rule.id} data-status={rule.rule_status}>
              <div className="cs-redirect-rule-main">
                <div className="cs-redirect-route"><strong>{rule.source_path}</strong><span>→</span><b>{rule.destination_url}</b></div>
                <div className="cs-redirect-meta"><span className="cs-redirect-status">{statusLabel(rule.rule_status)}</span><span>{rule.redirect_status}</span><span>{rule.destination_kind === "internal" ? "Internal" : "External HTTPS"}</span>{rule.expires_at ? <span>Expires {new Date(rule.expires_at).toLocaleString("en-GH")}</span> : null}</div>
                {rule.reason ? <p>{rule.reason}</p> : null}
              </div>
              <div className="cs-redirect-actions">
                {canManage && ["draft", "inactive"].includes(rule.rule_status) ? <button type="button" onClick={() => editRule(rule)}>Edit</button> : null}
                {canPublish && ["draft", "inactive"].includes(rule.rule_status) ? <button className="is-primary" type="button" disabled={busyId === Number(rule.id)} onClick={() => runAction(rule, "activate")}>Activate</button> : null}
                {canPublish && rule.rule_status === "active" ? <button type="button" disabled={busyId === Number(rule.id)} onClick={() => runAction(rule, "deactivate")}>Deactivate</button> : null}
                {canManage && ["draft", "inactive"].includes(rule.rule_status) ? <button className="is-danger" type="button" disabled={busyId === Number(rule.id)} onClick={() => runAction(rule, "archive")}>Archive</button> : null}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
