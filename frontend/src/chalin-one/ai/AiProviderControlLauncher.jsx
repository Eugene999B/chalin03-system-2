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
    description: "Anonymous public website assistant. Only published public evidence is permitted.",
  }),
  Object.freeze({
    key: "copilot",
    title: "Staff Copilot",
    description: "Permission-scoped operational assistant. Private data stays Local unless an approved private external tier is enabled.",
  }),
  Object.freeze({
    key: "executive",
    title: "Chalin Executive",
    description: "Executive intelligence. Confidential business evidence defaults to CHALIN Local under the current no-paid policy.",
  }),
]);

const PROVIDER_ORDER = Object.freeze(["local", "gemini", "openai"]);

function providerLabel(provider) {
  if (!provider) return "Unknown";
  return provider.label || provider.key || "Unknown";
}

function selectionNote(selection) {
  const reason = String(selection?.reason_code || "");
  if (reason === "AI_GEMINI_FREE_PRIVATE_DATA_LOCAL_FALLBACK") {
    return "Gemini Free is selected, but this private surface automatically uses CHALIN Local.";
  }
  if (reason === "AI_EXTERNAL_PRIVATE_DATA_LOCAL_FALLBACK") {
    return "The external provider is selected, but private data is blocked to CHALIN Local by policy.";
  }
  if (reason === "AI_PROVIDER_CREDENTIAL_MISSING_LOCAL_FALLBACK") {
    return "The selected external provider has no protected server credential, so CHALIN Local is active.";
  }
  return "The selected provider is active for this surface under the current privacy policy.";
}

function ProviderBadge({ provider }) {
  const ready = provider?.credential_required !== true || provider?.credential_configured === true;
  return (
    <span className="aipc-provider-badge" data-ready={ready ? "true" : "false"}>
      {provider?.zero_cost ? "Zero-cost" : "Paid/optional"} · {ready ? "Ready" : "Key not configured"}
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

  async function changeProvider(persona, providerKey) {
    if (!canManage || saving) return;
    setSaving(persona);
    setSaved("");
    setError("");
    try {
      const result = await updateAiProviderControl(persona, {
        providerKey,
        modelKey: null,
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
              <p>Choose the preferred engine for each intelligence surface. Privacy routing can override an unsafe selection.</p>
            </div>
            <button type="button" aria-label="Close AI Provider Control" onClick={() => setOpen(false)}>×</button>
          </header>

          <div className="aipc-notice">
            API keys are never entered or stored here. External provider secrets stay server-side in the protected Railway environment. Under the current no-paid policy, Gemini Free is public-only and private business data falls back to CHALIN Local.
          </div>

          {error ? <div className="aipc-error" role="alert">{error}</div> : null}
          {loading ? <div className="aipc-state" role="status">Loading governed provider policy…</div> : null}

          {!loading && canManage ? (
            <div className="aipc-personas">
              {PERSONAS.map((persona) => {
                const profile = control?.profiles?.[persona.key] || {};
                const selection = profile.selection || {};
                const selected = selection.selected_provider || profile.provider_key || "local";
                const effective = selection.effective_provider || selected;
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

                    <div className="aipc-route">
                      <span>Selected <strong>{providerLabel(providers[selected])}</strong></span>
                      <span aria-hidden="true">→</span>
                      <span>Effective <strong>{providerLabel(providers[effective])}</strong></span>
                    </div>
                    <p className="aipc-reason">{selectionNote(selection)}</p>

                    <div className="aipc-provider-status">
                      {providerOptions.map((provider) => (
                        <div key={provider.key}>
                          <strong>{providerLabel(provider)}</strong>
                          <ProviderBadge provider={provider} />
                          {provider.key === "gemini" ? (
                            <small>
                              Tier: {provider.service_tier || "free"}. Private external data: {provider.private_data_supported ? "allowed by server policy" : "blocked"}.
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
            <span>Local remains available as the fail-safe provider.</span>
            <button type="button" onClick={() => load()} disabled={loading || Boolean(saving)}>Refresh</button>
          </footer>
        </section>
      ) : null}
    </div>
  );
}
