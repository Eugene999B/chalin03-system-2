import { useCallback, useEffect, useMemo, useState } from "react";
import {
  aiErrorMessage,
  getAiProviderControl,
  updateAiProviderControl,
} from "./aiApi";
import "./aiProviderControl.css";

const PERSONAS = Object.freeze([
  Object.freeze({
    key: "guide",
    title: "Public Chalin Guide",
    description: "Anonymous public website assistant. Published public evidence only.",
  }),
  Object.freeze({
    key: "copilot",
    title: "Staff Copilot",
    description: "Your main CHALIN assistant for conversation, operational intelligence, tools and long-running work.",
  }),
  Object.freeze({
    key: "executive",
    title: "Chalin Executive",
    description: "Deep executive reasoning across the governed business evidence available to the signed-in executive account.",
  }),
]);

const PROVIDER_ORDER = Object.freeze(["local", "gemini", "openai"]);

function providerLabel(provider) {
  if (!provider) return "Unknown";
  return provider.label || provider.key || "Unknown";
}

function selectionNote(selection) {
  const reason = String(selection?.reason_code || "");
  if (reason === "AI_GEMINI_SYSTEM_ADMIN_FULL_CONTEXT") {
    return "Full Gemini Intelligence is active for the administrator account that enabled it.";
  }
  if (reason === "AI_GEMINI_FULL_CONTEXT_REQUIRES_PAID_TIER") {
    return "Full Gemini Intelligence is requested, but this Gemini project is still on an unpaid tier. Private/confidential data therefore remains on CHALIN Local.";
  }
  if (reason === "AI_GEMINI_FREE_PRIVATE_DATA_LOCAL_FALLBACK") {
    return "Gemini handles public/general reasoning, while private business evidence stays on CHALIN Local on the unpaid tier.";
  }
  if (reason === "AI_EXTERNAL_PRIVATE_DATA_LOCAL_FALLBACK") {
    return "The external provider is selected, but private data is blocked to CHALIN Local by server policy.";
  }
  if (reason === "AI_PROVIDER_CREDENTIAL_MISSING_LOCAL_FALLBACK") {
    return "The selected external provider has no recognized server credential, so CHALIN Local is active.";
  }
  return "The selected provider is active for this surface under the current account and data policy.";
}

function ProviderBadge({ provider }) {
  const ready = provider?.credential_required !== true || provider?.credential_configured === true;
  return (
    <span className="aipc-provider-badge" data-ready={ready ? "true" : "false"}>
      {provider?.zero_cost ? "Zero-cost" : "External"} · {ready ? "Ready" : "Key not configured"}
    </span>
  );
}

export default function AiProviderControlLauncher() {
  const [open, setOpen] = useState(false);
  const [control, setControl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    try {
      const next = await getAiProviderControl({ signal });
      setControl(next);
    } catch (requestError) {
      const message = aiErrorMessage(requestError);
      if (message) setError(message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const providers = control?.providers || {};
  const canManage = control?.can_manage === true;
  const providerOptions = useMemo(
    () => PROVIDER_ORDER.map((key) => providers[key]).filter(Boolean),
    [providers]
  );

  if (!loading && !canManage) return null;

  async function savePersona(persona, providerKey, fullContextAccess) {
    if (!canManage || saving) return;
    setSaving(persona);
    setSaved("");
    setError("");
    try {
      const result = await updateAiProviderControl(persona, {
        providerKey,
        modelKey: null,
        fullContextAccess,
      });
      setControl({
        ...(result?.control || control || {}),
        can_manage: true,
      });
      setSaved(persona);
      window.setTimeout(() => setSaved(""), 2200);
    } catch (requestError) {
      setError(aiErrorMessage(requestError));
    } finally {
      setSaving("");
    }
  }

  async function changeProvider(persona, providerKey) {
    const profile = control?.profiles?.[persona] || {};
    const keepFullContext =
      providerKey === "gemini" && profile.full_context_requested === true;
    await savePersona(persona, providerKey, keepFullContext);
  }

  async function changeFullContext(persona, enabled) {
    const profile = control?.profiles?.[persona] || {};
    const selected = profile?.selection?.selected_provider || profile.provider_key || "gemini";
    await savePersona(persona, selected === "gemini" ? selected : "gemini", enabled);
  }

  return (
    <div className="aipc-root">
      <button
        className="aipc-launcher"
        type="button"
        aria-expanded={open}
        aria-controls="ai-provider-control-panel"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">AI</span>
        Provider Control
      </button>

      {open ? (
        <section
          id="ai-provider-control-panel"
          className="aipc-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="ai-provider-control-title"
        >
          <header className="aipc-head">
            <div>
              <span className="aipc-eyebrow">System Administrator</span>
              <h2 id="ai-provider-control-title">CHALIN AI Provider Control</h2>
              <p>Choose the reasoning engine and, where permitted by the provider tier, bind full private business context to your administrator account.</p>
            </div>
            <button type="button" aria-label="Close AI Provider Control" onClick={() => setOpen(false)}>×</button>
          </header>

          <div className="aipc-notice">
            API keys never enter this page. Gemini can be the primary conversational/reasoning engine. Full private/confidential context is account-bound and activates only on a Gemini tier that permits private-data processing; credentials and cross-user data are never exposed.
          </div>

          {error ? <div className="aipc-error" role="alert">{error}</div> : null}
          {loading ? <div className="aipc-state" role="status">Loading provider policy…</div> : null}

          {!loading && canManage ? (
            <div className="aipc-personas">
              {PERSONAS.map((persona) => {
                const profile = control?.profiles?.[persona.key] || {};
                const selection = profile.selection || {};
                const selected = selection.selected_provider || profile.provider_key || "local";
                const effective = selection.effective_provider || selected;
                const fullContextRequested = profile.full_context_requested === true;
                const supportsFullContext = persona.key !== "guide";
                return (
                  <article className="aipc-card" key={persona.key}>
                    <div className="aipc-card-head">
                      <div>
                        <h3>{persona.title}</h3>
                        <p>{persona.description}</p>
                      </div>
                      {saved === persona.key ? <span className="aipc-saved">Saved</span> : null}
                    </div>

                    <label>
                      Preferred provider
                      <select
                        value={selected}
                        disabled={saving === persona.key}
                        onChange={(event) => changeProvider(persona.key, event.target.value)}
                      >
                        {providerOptions.map((provider) => (
                          <option key={provider.key} value={provider.key}>
                            {providerLabel(provider)}
                          </option>
                        ))}
                      </select>
                    </label>

                    {supportsFullContext ? (
                      <label className="aipc-full-context">
                        <input
                          type="checkbox"
                          checked={fullContextRequested}
                          disabled={saving === persona.key}
                          onChange={(event) => changeFullContext(persona.key, event.target.checked)}
                        />
                        <span>
                          <strong>Full Gemini Intelligence</strong>
                          <small>
                            Bind Gemini private/internal business context to the administrator account that enables this setting. Current status: {selection.full_context_active ? "active" : selection.full_context_requires_paid_tier ? "waiting for paid/private Gemini tier" : fullContextRequested ? "requested" : "off"}.
                          </small>
                        </span>
                      </label>
                    ) : null}

                    <div className="aipc-route">
                      <span>Selected <strong>{providerLabel(providers[selected])}</strong></span>
                      <span aria-hidden="true">→</span>
                      <span>Effective <strong>{providerLabel(providers[effective])}</strong></span>
                    </div>
                    <p className="aipc-reason">{selectionNote(selection)}</p>
                    <p className="aipc-reason">
                      Model: <strong>{selection.effective_model || profile.model_key || "provider default"}</strong>
                    </p>

                    <div className="aipc-provider-status">
                      {providerOptions.map((provider) => (
                        <div key={provider.key}>
                          <strong>{providerLabel(provider)}</strong>
                          <ProviderBadge provider={provider} />
                          {provider.key === "gemini" ? (
                            <small>
                              Tier: {provider.service_tier || "free"}. Full private context: {provider.full_context_capable ? "provider tier capable" : "not permitted on this tier"}.
                            </small>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}

          <footer className="aipc-footer">
            <span>CHALIN Local remains available as an offline/privacy fallback when an external provider cannot be used.</span>
            <button type="button" onClick={() => load()} disabled={loading || Boolean(saving)}>Refresh status</button>
          </footer>
        </section>
      ) : null}
    </div>
  );
}
