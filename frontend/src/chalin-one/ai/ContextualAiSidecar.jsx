import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFeatureFlags } from "../../context/FeatureFlagContext";
import {
  contextualAiErrorMessage,
  getContextualAiStatus,
  sendContextualAiMessage,
} from "./contextualAiApi";
import { contextualAiProfileForPath } from "./contextualAiModel";
import "./contextualAi.css";

function currentPath() {
  return window.location.pathname || "/";
}

function currentScopeFingerprint() {
  try {
    const user = JSON.parse(localStorage.getItem("chalin03_user") || "null");
    const workspace =
      user?.workspace_code || user?.active_workspace?.code || "";
    const branch =
      workspace === "spare_parts"
        ? user?.branch_id || user?.default_branch_id || ""
        : "";
    const context =
      workspace === "mining"
        ? localStorage.getItem("chalin03_active_context_mining") || ""
        : workspace === "equipment_hire" &&
            !currentPath().startsWith("/equipment-installment-finance")
          ? localStorage.getItem("chalin03_active_context_equipment_hire") || ""
          : "";
    return `${workspace}:${branch}:${context}`;
  } catch {
    return "";
  }
}

function permissionSet(status) {
  return new Set(
    Array.isArray(status?.permissions?.permissions)
      ? status.permissions.permissions
      : []
  );
}

function RobotIcon() {
  return (
    <svg className="cai-robot-icon" viewBox="0 0 48 48" aria-hidden="true">
      <path className="cai-robot-antenna" d="M24 10V6m0 0 4-3m-4 3-4-3" />
      <rect x="10" y="11" width="28" height="25" rx="9" />
      <path d="M7 21h3m28 0h3M16 39h16" />
      <circle cx="19" cy="23" r="2.3" />
      <circle cx="29" cy="23" r="2.3" />
      <path d="M18 29c2 2 10 2 12 0" />
    </svg>
  );
}

function Evidence({ evidence = [] }) {
  if (!Array.isArray(evidence) || evidence.length === 0) return null;
  return (
    <div className="cai-evidence">
      <span>Governed evidence</span>
      {evidence.slice(0, 6).map((item, index) => (
        <details key={`${item.source_type || "source"}-${item.source_ref || index}`}>
          <summary>
            [{item.citation || `E${index + 1}`}] {item.label || "CHALIN evidence"}
          </summary>
          <p>{item.excerpt_text || "Evidence record available."}</p>
        </details>
      ))}
    </div>
  );
}

function ProviderLine({ result }) {
  const provider = result?.provider?.key || "unknown";
  const model = result?.provider?.model || "unknown";
  const selected = result?.context?.provider_selected;
  const effective = result?.context?.provider_effective;
  const privacyFallback = selected && effective && selected !== effective;
  return (
    <div className="cai-provider-line">
      <span>Engine: {provider} · {model}</span>
      {privacyFallback ? (
        <strong>Privacy routing changed {selected} → {effective}</strong>
      ) : null}
    </div>
  );
}

export default function ContextualAiSidecar() {
  const { flags, audience } = useFeatureFlags();
  const [pathname, setPathname] = useState(currentPath);
  const [profile, setProfile] = useState(() =>
    contextualAiProfileForPath(currentPath())
  );
  const [status, setStatus] = useState(null);
  const [open, setOpen] = useState(false);
  const [persona, setPersona] = useState("copilot");
  const [conversationKey, setConversationKey] = useState(null);
  const [scopeFingerprint, setScopeFingerprint] = useState(currentScopeFingerprint);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef(null);

  const resetConversation = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    setConversationKey(null);
    setMessages([]);
    setInput("");
    setError("");
    setLoading(false);
  }, []);

  useEffect(() => {
    const onRoute = (event) => {
      const nextPath = String(event?.detail?.pathname || currentPath());
      const nextProfile = contextualAiProfileForPath(nextPath);
      setPathname(nextPath);
      setProfile(nextProfile);
      setOpen(false);
      setScopeFingerprint(currentScopeFingerprint());
      resetConversation();
    };
    window.addEventListener("chalin:route-change", onRoute);
    window.addEventListener("popstate", onRoute);
    return () => {
      window.removeEventListener("chalin:route-change", onRoute);
      window.removeEventListener("popstate", onRoute);
    };
  }, [resetConversation]);

  useEffect(() => {
    if (
      audience !== "staff" ||
      flags?.aiEnabled !== true ||
      !profile
    ) {
      setStatus(null);
      return undefined;
    }
    const controller = new AbortController();
    getContextualAiStatus({ signal: controller.signal })
      .then(setStatus)
      .catch((requestError) => {
        if (!controller.signal.aborted) {
          setStatus(null);
          const message = contextualAiErrorMessage(requestError);
          if (message) setError(message);
        }
      });
    return () => controller.abort();
  }, [audience, flags?.aiEnabled, profile?.key]);

  useEffect(
    () => () => {
      requestRef.current?.abort();
    },
    []
  );

  const permissions = useMemo(() => permissionSet(status), [status]);
  const canChat =
    flags?.aiEnabled === true &&
    flags?.chalinCopilot === true &&
    permissions.has("ai.use") &&
    permissions.has("ai.conversations.manage");
  const canExecutive =
    flags?.chalinExecutive === true &&
    permissions.has("ai.executive.use");

  useEffect(() => {
    if (persona === "executive" && !canExecutive) setPersona("copilot");
  }, [canExecutive, persona]);

  if (!profile || audience !== "staff" || !canChat) return null;

  async function send(messageText) {
    const text = String(messageText || "").trim();
    if (!text || loading) return;

    const freshFingerprint = currentScopeFingerprint();
    let activeConversationKey = conversationKey;
    if (freshFingerprint !== scopeFingerprint) {
      activeConversationKey = null;
      setConversationKey(null);
      setMessages([]);
      setScopeFingerprint(freshFingerprint);
    }

    const userEntry = {
      id: `user-${Date.now()}`,
      role: "user",
      text,
    };
    setMessages((current) => [...current, userEntry]);
    setInput("");
    setError("");
    setLoading(true);

    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    try {
      const result = await sendContextualAiMessage(
        persona,
        {
          contextKey: profile.key,
          conversationKey: activeConversationKey,
          message: text,
        },
        { signal: controller.signal }
      );
      if (!result) return;
      setConversationKey(result.conversation_key || null);
      setMessages((current) => [
        ...current,
        {
          id: result.message_key || `assistant-${Date.now()}`,
          role: "assistant",
          text: result.answer || "CHALIN returned no answer text.",
          evidence: result.evidence || [],
          result,
        },
      ]);
    } catch (requestError) {
      const message = contextualAiErrorMessage(requestError);
      if (message) setError(message);
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  function switchPersona(nextPersona) {
    if (nextPersona === persona) return;
    setPersona(nextPersona);
    resetConversation();
  }

  return (
    <div className="cai-root" data-context-key={profile.key} data-pathname={pathname}>
      <button
        type="button"
        className="cai-launcher"
        aria-label={`Open CHALIN mini chat for ${profile.shortTitle}`}
        aria-expanded={open}
        aria-controls="chalin-contextual-ai-panel"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="cai-launcher-robot" aria-hidden="true">
          <RobotIcon />
          <i className="cai-launcher-status" />
        </span>
        <span className="cai-launcher-tooltip" aria-hidden="true">Ask CHALIN</span>
      </button>

      {open ? (
        <section
          id="chalin-contextual-ai-panel"
          className="cai-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="chalin-contextual-ai-title"
        >
          <header className="cai-head">
            <div>
              <span className="cai-kicker">{profile.accent} · live governed context</span>
              <h2 id="chalin-contextual-ai-title">{profile.title}</h2>
              <p>CHALIN reads only the operational evidence your current account and scope are already allowed to see.</p>
            </div>
            <div className="cai-head-actions">
              <a
                className="cai-expand-button"
                href="/intelligence"
                aria-label="Open full Intelligence"
                title="Expand to full Intelligence"
              >
                ↗
              </a>
              <button type="button" aria-label="Close contextual CHALIN" onClick={() => setOpen(false)}>×</button>
            </div>
          </header>

          <div className="cai-safety-bar">
            <span>Read-only intelligence</span>
            <span>Server-owned context</span>
            <span>No autonomous business changes</span>
          </div>

          <div className="cai-persona-row" role="group" aria-label="CHALIN persona">
            <button
              type="button"
              className={persona === "copilot" ? "is-active" : ""}
              onClick={() => switchPersona("copilot")}
            >
              Copilot
            </button>
            {canExecutive ? (
              <button
                type="button"
                className={persona === "executive" ? "is-active" : ""}
                onClick={() => switchPersona("executive")}
              >
                Executive
              </button>
            ) : null}
            <a href="/intelligence" aria-label="Open full Intelligence">Expand full Intelligence ↗</a>
          </div>

          <div className="cai-stream" aria-live="polite">
            {messages.length === 0 ? (
              <div className="cai-empty">
                <strong>Ask about this page, not the whole system.</strong>
                <p>CHALIN will first inspect the approved live aggregate for this operational context, then combine it with governed knowledge and explain what the evidence supports.</p>
                <div className="cai-starters">
                  {profile.starters.map((starter) => (
                    <button key={starter} type="button" onClick={() => send(starter)}>
                      {starter}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <article
                  key={message.id}
                  className={`cai-message cai-message-${message.role}`}
                >
                  <strong>{message.role === "user" ? "You" : persona === "executive" ? "Chalin Executive" : "Chalin Copilot"}</strong>
                  <div className="cai-bubble">{message.text}</div>
                  {message.role === "assistant" ? (
                    <>
                      <ProviderLine result={message.result} />
                      <Evidence evidence={message.evidence} />
                    </>
                  ) : null}
                </article>
              ))
            )}
            {loading ? <div className="cai-thinking" role="status">CHALIN is checking governed live evidence…</div> : null}
            {error ? <div className="cai-error" role="alert">{error}</div> : null}
          </div>

          <form
            className="cai-composer"
            onSubmit={(event) => {
              event.preventDefault();
              send(input);
            }}
          >
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value.slice(0, 8000))}
              placeholder={`Ask CHALIN about ${profile.shortTitle.toLowerCase()}…`}
              maxLength={8000}
              rows={2}
              disabled={loading}
            />
            <button type="submit" disabled={loading || !input.trim()}>
              {loading ? "Checking…" : "Ask"}
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}

export { currentScopeFingerprint, permissionSet };