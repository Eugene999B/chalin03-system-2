import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import { useAppearance } from "../../appearance/AppearanceContext";
import {
  loadAiChatPreferences,
  saveAiChatPreferences,
} from "../../appearance/aiChatPreferences";
import { useAuth } from "../../context/AuthContext";
import {
  AI_PERSONAS,
  aiErrorMessage,
  clearAiConversationHistory,
  createAiFeedback,
  createAiKnowledgeDraft,
  decideAiKnowledgeApproval,
  deleteAiConversation,
  getAiConversation,
  getAiKnowledgeSource,
  getAiStatus,
  listAiConversations,
  listAiKnowledge,
  listAiTools,
  listAiUsage,
  publishAiKnowledgeVersion,
  renameAiConversation,
  sendAiMessage,
  submitAiKnowledgeVersion,
} from "./aiApi";
import "./chalinIntelligence.css";

const CHAT_STARTERS = Object.freeze({
  copilot: Object.freeze([
    "Explain any part of CHALIN 03 I ask about and tell me how it should work.",
    "Help me think through an IT, product or security improvement for CHALIN.",
    "Help me create a marketing or business strategy for CHALIN.",
    "Investigate my authorized live business data when I ask for current figures.",
  ]),
  executive: Object.freeze([
    "Give me an executive brief: performance, risks, opportunities and what needs a decision.",
    "Challenge our current position. What are the strongest competing explanations for the numbers?",
    "Compare the most important business signals and recommend the highest-value priorities.",
    "Recall the relevant strategic history from our earlier conversations and update the assessment with current evidence.",
  ]),
});

const EMPTY_KNOWLEDGE_FORM = Object.freeze({
  source_key: "",
  source_type: "policy",
  visibility: "workspace",
  title: "",
  description: "",
  source_reference: "",
  body_text: "",
  effective_from: "",
  expires_at: "",
});

const ACTIVE_CHAT_PREFIX = "chalin03_ai_active_chat_v1";
const DRAFT_PREFIX = "chalin03_ai_draft_v1";

function storagePart(value) {
  return String(value || "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .slice(0, 80) || "unknown";
}

function activeChatStorageKey(persona, workspaceCode) {
  return `${ACTIVE_CHAT_PREFIX}:${storagePart(workspaceCode)}:${storagePart(persona)}`;
}

function rememberActiveConversation(persona, workspaceCode, conversationKey) {
  if (!conversationKey) return;
  try {
    localStorage.setItem(
      activeChatStorageKey(persona, workspaceCode),
      String(conversationKey)
    );
  } catch {
    // Persistence is helpful but never required for chat operation.
  }
}

function readActiveConversation(persona, workspaceCode) {
  try {
    return localStorage.getItem(activeChatStorageKey(persona, workspaceCode)) || null;
  } catch {
    return null;
  }
}

function forgetActiveConversation(persona, workspaceCode) {
  try {
    localStorage.removeItem(activeChatStorageKey(persona, workspaceCode));
  } catch {
    // Nothing else is required.
  }
}

function draftStorageKey(value) {
  return `${DRAFT_PREFIX}:${storagePart(value)}`;
}

function readDraft(value) {
  try {
    return sessionStorage.getItem(draftStorageKey(value)) || "";
  } catch {
    return "";
  }
}

function saveDraft(value, draft) {
  try {
    const key = draftStorageKey(value);
    if (draft) sessionStorage.setItem(key, draft);
    else sessionStorage.removeItem(key);
  } catch {
    // Draft persistence is best-effort only.
  }
}

function humanize(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value, includeTime = false) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return includeTime
    ? date.toLocaleString("en-GH")
    : date.toLocaleDateString("en-GH", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

function deriveConversationTitle(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "New conversation";
  if (/^(?:hi|hello|hey|hiya|greetings|good\s+(?:morning|afternoon|evening)|how\s+(?:are|r)\s+you(?:\s+doing)?|thanks|thank\s+you|okay|ok|cool|great|nice|bye|goodbye)[\s!.?,'-]*$/i.test(text)) {
    return "General Conversation";
  }
  const cleaned = text
    .replace(/^(?:(?:hi|hello|hey|hiya|greetings|good\s+(?:morning|afternoon|evening))[,!?.\s-]*)+/i, "")
    .replace(/^(?:(?:please|can\s+you|could\s+you|would\s+you|tell\s+me|show\s+me|explain|help\s+me|what\s+is|what\s+are|how\s+is|how\s+are)\s+)+/i, "")
    .replace(/[?!.]+$/g, "")
    .trim();
  if (!cleaned) return "General Conversation";
  return cleaned
    .split(/\s+/)
    .slice(0, 10)
    .join(" ")
    .slice(0, 72)
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function permissionSet(status) {
  return new Set(
    Array.isArray(status?.permissions?.permissions)
      ? status.permissions.permissions
      : []
  );
}

function canUsePersona(status, persona) {
  const permissions = permissionSet(status);
  if (persona === AI_PERSONAS.copilot) {
    return status?.flags?.chalinCopilot === true && permissions.has("ai.use");
  }
  return (
    status?.flags?.chalinExecutive === true &&
    permissions.has("ai.executive.use")
  );
}

function StatePanel({ loading = false, error = "", empty = false, children }) {
  if (loading) {
    return (
      <div className="ci-state" role="status" aria-live="polite">
        <strong>Loading CHALIN ONE intelligence…</strong>
        <span>Applying your server-side permissions and workspace scope.</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="ci-state ci-state-error" role="alert">
        <strong>Intelligence unavailable</strong>
        <span>{error}</span>
      </div>
    );
  }
  if (empty) {
    return (
      <div className="ci-state">
        <strong>No records yet</strong>
        <span>This area will appear when governed records are available.</span>
      </div>
    );
  }
  return children;
}

function documentEvidenceLink(item) {
  const metadata = item?.metadata || {};
  const documentId = Number(metadata.document_id || 0);
  const chunkId = Number(metadata.chunk_id || 0);
  const sourceKey = String(item?.source_ref || "").split("#", 1)[0];
  if (!sourceKey || !documentId || !chunkId) return null;
  const params = new URLSearchParams({
    source: sourceKey,
    document: String(documentId),
    chunk: String(chunkId),
  });
  return `/intelligence/documents?${params.toString()}`;
}

function EvidenceList({ evidence = [] }) {
  if (!Array.isArray(evidence) || evidence.length === 0) return null;
  return (
    <div className="ci-evidence" aria-label="Answer evidence">
      {evidence.map((item, index) => {
        const deepLink = documentEvidenceLink(item);
        return (
          <details key={`${item.source_type}-${item.source_ref}-${index}`}>
            <summary>
              [{item.citation || `E${index + 1}`}] {item.label}
            </summary>
            <div className="ci-evidence-detail">
              <strong>
                {humanize(item.source_type)} · {item.source_ref}
                {item.source_version ? ` · Version ${item.source_version}` : ""}
              </strong>
              {item.excerpt_text ? <p>{item.excerpt_text}</p> : null}
              <small>
                {item.classification ? humanize(item.classification) : "Approved evidence"}
                {item.as_of_at ? ` · As of ${formatDate(item.as_of_at, true)}` : ""}
              </small>
              {deepLink ? (
                <Link
                  className="ci-button ci-button-secondary"
                  style={{ marginTop: 8, width: "fit-content" }}
                  to={deepLink}
                >
                  Open exact governed chunk
                </Link>
              ) : null}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function FeedbackButtons({ conversationKey, messageKey, onFeedback }) {
  const [sent, setSent] = useState("");
  const [error, setError] = useState("");

  async function submit(rating) {
    if (sent) return;
    setError("");
    try {
      await createAiFeedback({
        conversation_key: conversationKey,
        message_key: messageKey,
        rating,
      });
      setSent(rating);
      onFeedback?.(rating);
    } catch (requestError) {
      setError(aiErrorMessage(requestError));
    }
  }

  return (
    <>
      <div className="ci-feedback" aria-label="Rate this answer">
        <button type="button" title="Helpful" aria-label="Mark answer helpful" disabled={Boolean(sent)} onClick={() => submit("helpful")}>✓</button>
        <button type="button" title="Not helpful" aria-label="Mark answer not helpful" disabled={Boolean(sent)} onClick={() => submit("not_helpful")}>−</button>
        <button type="button" title="Incorrect" aria-label="Report incorrect answer" disabled={Boolean(sent)} onClick={() => submit("incorrect")}>!</button>
        <button type="button" title="Unsafe" aria-label="Report unsafe answer" disabled={Boolean(sent)} onClick={() => submit("unsafe")}>⚠</button>
        {sent ? <span className="ci-status-pill" data-state="success">Feedback recorded</span> : null}
      </div>
      {error ? <small className="ci-banner ci-banner-danger">{error}</small> : null}
    </>
  );
}

function ChatMessage({ message, persona, conversationKey, resultMeta = null, showTechnicalDetails = false }) {
  const assistant = message.role === "assistant";
  return (
    <article className={`ci-message ci-message-${assistant ? "assistant" : "user"}`}>
      <div className="ci-message-avatar" aria-hidden="true">
        {assistant ? (persona === "executive" ? "EX" : "C1") : "YOU"}
      </div>
      <div className="ci-message-body">
        <strong>{assistant ? humanize(persona) : "You"}</strong>
        <div className="ci-message-text">{message.content || message.answer}</div>
        {assistant ? <EvidenceList evidence={message.evidence || resultMeta?.evidence} /> : null}
        {assistant && showTechnicalDetails ? (
          <div className="ci-message-meta">
            {message.model_key || resultMeta?.provider?.model ? (
              <span>Model: {message.model_key || resultMeta.provider.model}</span>
            ) : null}
            {resultMeta?.provider?.reasoning_effort ? (
              <span>Thinking: {humanize(resultMeta.provider.reasoning_effort)}</span>
            ) : null}
            {message.safety_status ? <span>Safety: {humanize(message.safety_status)}</span> : null}
            {message.created_at ? <span>{formatDate(message.created_at, true)}</span> : null}
            {resultMeta?.usage ? (
              <span>Tokens: {Number(resultMeta.usage.input_tokens || 0) + Number(resultMeta.usage.output_tokens || 0)}</span>
            ) : null}
          </div>
        ) : null}
        {assistant && conversationKey && message.key ? (
          <FeedbackButtons conversationKey={conversationKey} messageKey={message.key} />
        ) : null}
      </div>
    </article>
  );
}

function ChatSettingsModal({ settings, setSettings, provider, historyCount, onRequestClearHistory, onClose }) {
  const { preference, resolved, setAppearance } = useAppearance();

  function updateSetting(key, value) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="ci-modal-backdrop ci-settings-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="ci-settings-panel" role="dialog" aria-modal="true" aria-labelledby="ci-settings-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="ci-settings-head">
          <div>
            <span className="ci-eyebrow">Conversation preferences</span>
            <h2 id="ci-settings-title">Settings</h2>
          </div>
          <button type="button" className="ci-plain-icon-button" aria-label="Close settings" onClick={onClose}>×</button>
        </header>
        <div className="ci-settings-body">
          <section className="ci-setting-section">
            <div className="ci-setting-copy">
              <strong>Appearance</strong>
              <span>Choose a calm workspace theme. Your choice is shared with staff login and workspaces.</span>
            </div>
            <div className="ci-appearance-options" role="group" aria-label="Appearance">
              {["light", "dark", "system"].map((option) => (
                <button
                  type="button"
                  key={option}
                  aria-pressed={preference === option}
                  onClick={() => setAppearance(option)}
                >
                  <span aria-hidden="true">{option === "light" ? "☀" : option === "dark" ? "☾" : "◐"}</span>
                  {humanize(option)}
                </button>
              ))}
            </div>
            <small className="ci-setting-note">Currently using {resolved} mode.</small>
          </section>

          <section className="ci-setting-row">
            <div className="ci-setting-copy">
              <strong>Send with Enter</strong>
              <span>Press Enter to send. Shift + Enter always creates a new line.</span>
            </div>
            <button
              type="button"
              className="ci-switch"
              role="switch"
              aria-checked={settings.sendWithEnter}
              onClick={() => updateSetting("sendWithEnter", !settings.sendWithEnter)}
            ><span /></button>
          </section>

          <section className="ci-setting-row">
            <div className="ci-setting-copy">
              <strong>Technical response details</strong>
              <span>Show model, thinking level, safety state, timestamps and token totals under replies.</span>
            </div>
            <button
              type="button"
              className="ci-switch"
              role="switch"
              aria-checked={settings.showTechnicalDetails}
              onClick={() => updateSetting("showTechnicalDetails", !settings.showTechnicalDetails)}
            ><span /></button>
          </section>

          <section className="ci-setting-section">
            <div className="ci-setting-copy">
              <strong>Clear chat history</strong>
              <span>Permanently delete your Copilot/Executive conversations for the current persona, including archived history. This never deletes business records or another user’s chats.</span>
            </div>
            <button type="button" className="ci-button ci-button-danger-solid" onClick={onRequestClearHistory}>
              Clear history{historyCount ? ` (${historyCount} active)` : ""}
            </button>
          </section>

          <section className="ci-settings-runtime">
            <span className="ci-eyebrow">Runtime</span>
            <strong>{provider?.key || "No provider"}{provider?.model_key ? ` · ${provider.model_key}` : ""}</strong>
            <p>CHALIN no longer participates in automatic service-worker reloads. Your active chat is also remembered so a manual refresh can reopen it.</p>
          </section>
        </div>
      </section>
    </div>
  );
}

function ClearHistoryDialog({ persona, busy, onClose, onConfirm }) {
  return (
    <div className="ci-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="ci-conversation-dialog" role="dialog" aria-modal="true" aria-labelledby="ci-clear-history-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span className="ci-eyebrow">History</span>
            <h2 id="ci-clear-history-title">Clear {humanize(persona)} history?</h2>
          </div>
          <button type="button" className="ci-plain-icon-button" aria-label="Close" onClick={onClose} disabled={busy}>×</button>
        </header>
        <p>This permanently removes your active, archived and blocked {humanize(persona)} conversations and their chat evidence. It does not delete CHALIN business records, audit records belonging to the business, or another user’s conversations.</p>
        <div className="ci-dialog-actions">
          <button type="button" className="ci-button ci-button-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="ci-button ci-button-danger-solid" onClick={onConfirm} disabled={busy}>
            {busy ? "Clearing…" : "Clear my history"}
          </button>
        </div>
      </section>
    </div>
  );
}

function ConversationActionDialog({ action, busy, onClose, onConfirm }) {
  const [title, setTitle] = useState(action?.item?.title || "");
  if (!action?.item) return null;
  const deleting = action.mode === "delete";

  return (
    <div className="ci-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="ci-conversation-dialog" role="dialog" aria-modal="true" aria-labelledby="ci-conversation-action-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span className="ci-eyebrow">Conversation</span>
            <h2 id="ci-conversation-action-title">{deleting ? "Delete conversation?" : "Rename conversation"}</h2>
          </div>
          <button type="button" className="ci-plain-icon-button" aria-label="Close" onClick={onClose}>×</button>
        </header>
        {deleting ? (
          <p>“{action.item.title || "New conversation"}” and its chat messages will be permanently removed.</p>
        ) : (
          <label className="ci-dialog-field">
            Conversation name
            <input autoFocus maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
        )}
        <div className="ci-dialog-actions">
          <button type="button" className="ci-button ci-button-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={deleting ? "ci-button ci-button-danger-solid" : "ci-button ci-button-primary"} onClick={() => onConfirm(title)} disabled={busy || (!deleting && !title.trim())}>
            {busy ? "Working…" : deleting ? "Delete" : "Save name"}
          </button>
        </div>
      </section>
    </div>
  );
}

function ConversationRow({ item, active, onOpen, onRename, onDelete }) {
  return (
    <div className="ci-conversation-row" data-active={active ? "true" : "false"}>
      <button type="button" className="ci-conversation-open" aria-current={active ? "true" : undefined} onClick={() => onOpen(item)}>
        <strong>{item.title || "New conversation"}</strong>
        <small>{formatDate(item.last_message_at || item.updated_at, true)}</small>
      </button>
      <details className="ci-conversation-more">
        <summary aria-label={`More options for ${item.title || "conversation"}`} title="Conversation options">•••</summary>
        <div className="ci-conversation-menu">
          <button type="button" onClick={() => onRename(item)}>Rename</button>
          <button type="button" className="is-danger" onClick={() => onDelete(item)}>Delete</button>
        </div>
      </details>
    </div>
  );
}

function ChatPanel({ persona, conversation, messages, sending, error, onSend, onStarter, settings, onOpenSettings, draftKey }) {
  const [draft, setDraft] = useState(() => readDraft(draftKey));
  const streamRef = useRef(null);

  useEffect(() => {
    setDraft(readDraft(draftKey));
  }, [draftKey]);

  useEffect(() => {
    saveDraft(draftKey, draft);
  }, [draft, draftKey]);

  useEffect(() => {
    const element = streamRef.current;
    if (!element) return;
    requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
    });
  }, [messages.length, sending]);

  async function submit(event) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;
    setDraft("");
    await onSend(message);
  }

  return (
    <section className="ci-chat-panel">
      <header className="ci-chat-head">
        <div className="ci-chat-head-copy">
          <span>{persona === "executive" ? "Executive" : "Copilot"}</span>
          <strong>{conversation?.title || "New chat"}</strong>
        </div>
        <button type="button" className="ci-chat-settings-button" onClick={onOpenSettings} aria-label="Open chat settings">
          <span aria-hidden="true">⚙</span>
          Settings
        </button>
      </header>
      <div className="ci-chat-stream" ref={streamRef}>
        {messages.length === 0 ? (
          <div className="ci-empty-chat">
            <div>
              <span className="ci-eyebrow">CHALIN intelligence</span>
              <h1>{persona === "executive" ? "What should we examine?" : "What can I help you work through?"}</h1>
              <p>
                Ask naturally about CHALIN itself, IT, marketing, strategy, business advice or your authorized live records. Product questions no longer trigger unrelated operational snapshots.
              </p>
              <div className="ci-starter-grid">
                {CHAT_STARTERS[persona].map((starter) => (
                  <button type="button" key={starter} onClick={() => onStarter(starter)}>
                    {starter}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((message, index) => (
            <ChatMessage
              key={message.key || `${message.role}-${index}`}
              message={message}
              persona={persona}
              conversationKey={conversation?.key}
              resultMeta={message.resultMeta}
              showTechnicalDetails={settings.showTechnicalDetails}
            />
          ))
        )}
        {sending ? (
          <div className="ci-thinking" role="status" aria-live="polite">
            <span className="ci-thinking-mark" aria-hidden="true">C1</span>
            <div><strong>CHALIN is thinking</strong><small>Understanding the question, then using product knowledge or authorized evidence only when needed…</small></div>
          </div>
        ) : null}
        {error ? <div className="ci-banner ci-banner-danger" role="alert">{error}</div> : null}
      </div>
      <div className="ci-composer-wrap">
        <form className="ci-composer" onSubmit={submit}>
          <textarea
            value={draft}
            maxLength={32000}
            placeholder={`Message ${persona === "executive" ? "Chalin Executive" : "Chalin Copilot"}`}
            aria-label="Intelligence message"
            disabled={sending}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (settings.sendWithEnter && event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button className="ci-send-button" type="submit" aria-label="Send message" disabled={sending || !draft.trim()}>
            {sending ? "…" : "↑"}
          </button>
        </form>
        <p className="ci-composer-note">
          {settings.sendWithEnter ? "Enter sends · Shift + Enter adds a line" : "Use the send button · Enter adds a line"}
        </p>
      </div>
    </section>
  );
}

function KnowledgeForm({ form, setForm, saving, error, onSubmit, onClose }) {
  return (
    <div className="ci-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="ci-modal" role="dialog" aria-modal="true" aria-labelledby="knowledge-form-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="ci-modal-head">
          <h2 id="knowledge-form-title">New governed knowledge draft</h2>
          <button type="button" className="ci-button ci-button-secondary ci-icon-button" aria-label="Close knowledge form" onClick={onClose}>×</button>
        </header>
        <div className="ci-modal-body">
          <form className="ci-form" onSubmit={onSubmit}>
            {error ? <div className="ci-banner ci-banner-danger">{error}</div> : null}
            <div className="ci-form-grid">
              <label>Source key<input required value={form.source_key} placeholder="equipment_hire_release_policy" onChange={(event) => setForm((current) => ({ ...current, source_key: event.target.value }))} /></label>
              <label>
                Source type
                <select value={form.source_type} onChange={(event) => setForm((current) => ({ ...current, source_type: event.target.value }))}>
                  {["policy", "manual", "catalogue", "procedure", "faq", "public_content", "report", "other"].map((option) => (
                    <option key={option} value={option}>{humanize(option)}</option>
                  ))}
                </select>
              </label>
              <label>
                Visibility
                <select value={form.visibility} onChange={(event) => setForm((current) => ({ ...current, visibility: event.target.value }))}>
                  {[["workspace", "Current workspace"], ["public", "Published public"], ["restricted", "Restricted"], ["executive", "Executive"]].map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>Source reference<input value={form.source_reference} placeholder="Policy register or approved file reference" onChange={(event) => setForm((current) => ({ ...current, source_reference: event.target.value }))} /></label>
              <label>Effective from<input type="datetime-local" value={form.effective_from} onChange={(event) => setForm((current) => ({ ...current, effective_from: event.target.value }))} /></label>
              <label>Expires at<input type="datetime-local" value={form.expires_at} onChange={(event) => setForm((current) => ({ ...current, expires_at: event.target.value }))} /></label>
            </div>
            <label>Title<input required value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} /></label>
            <label>Description<textarea rows="3" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
            <label>Approved-source content<textarea required value={form.body_text} placeholder="Enter factual, source-backed knowledge. This remains a draft until independent review and publication." onChange={(event) => setForm((current) => ({ ...current, body_text: event.target.value }))} /></label>
            <button className="ci-button ci-button-primary" type="submit" disabled={saving}>{saving ? "Creating draft…" : "Create governed draft"}</button>
          </form>
        </div>
      </section>
    </div>
  );
}

function KnowledgeDetailModal({ details, permissions, busy, error, onClose, onSubmitReview, onDecision, onPublish }) {
  const [reviewerId, setReviewerId] = useState("");
  const [note, setNote] = useState("");
  const latest = details?.versions?.[0] || null;
  const pending = details?.approvals?.find((approval) => approval.approval_status === "pending");

  return (
    <div className="ci-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="ci-modal" role="dialog" aria-modal="true" aria-labelledby="knowledge-detail-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="ci-modal-head">
          <div><span className="ci-eyebrow">Governed knowledge</span><h2 id="knowledge-detail-title">{details.source.title}</h2></div>
          <button type="button" className="ci-button ci-button-secondary ci-icon-button" aria-label="Close knowledge details" onClick={onClose}>×</button>
        </header>
        <div className="ci-modal-body">
          {error ? <div className="ci-banner ci-banner-danger">{error}</div> : null}
          <div className="ci-card">
            <p>{details.source.description || "No description supplied."}</p>
            <div className="ci-card-meta">
              <span>{humanize(details.source.source_type)}</span><span>{humanize(details.source.visibility)}</span><span>{humanize(details.source.source_status)}</span>
              {details.source.owner_workspace_code ? <span>{humanize(details.source.owner_workspace_code)}</span> : null}
            </div>
          </div>
          {latest ? (
            <article className="ci-card" style={{ marginTop: 14 }}>
              <span className="ci-eyebrow">Latest version {latest.version_number}</span><h3>{latest.title}</h3>
              <p style={{ whiteSpace: "pre-wrap" }}>{latest.body_text}</p>
              <div className="ci-card-meta"><span>{humanize(latest.version_status)}</span><span>Checksum {String(latest.checksum_sha256 || "").slice(0, 12)}…</span>{latest.published_at ? <span>Published {formatDate(latest.published_at, true)}</span> : null}</div>
            </article>
          ) : null}
          {pending ? (
            <article className="ci-card" style={{ marginTop: 14 }}>
              <span className="ci-eyebrow">Pending review</span><p>{pending.request_note || "No review note supplied."}</p>
              <div className="ci-card-meta"><span>Assigned user {pending.assigned_to || "Unassigned"}</span><span>Approval #{pending.id}</span></div>
            </article>
          ) : null}
          <div className="ci-form" style={{ marginTop: 14 }}>
            <label>Workflow note<textarea rows="3" value={note} onChange={(event) => setNote(event.target.value)} /></label>
            {permissions.has("ai.knowledge.manage") && latest?.version_status === "draft" ? <label>Independent reviewer user ID<input type="number" min="1" value={reviewerId} onChange={(event) => setReviewerId(event.target.value)} /></label> : null}
            <div className="ci-card-actions">
              {permissions.has("ai.knowledge.manage") && latest?.version_status === "draft" ? <button type="button" className="ci-button ci-button-primary" disabled={busy || !reviewerId} onClick={() => onSubmitReview(latest.id, reviewerId, note)}>Submit exact version</button> : null}
              {permissions.has("ai.knowledge.review") && pending ? <><button type="button" className="ci-button ci-button-primary" disabled={busy} onClick={() => onDecision(pending.id, "approved", note)}>Approve</button><button type="button" className="ci-button ci-button-danger" disabled={busy} onClick={() => onDecision(pending.id, "rejected", note)}>Reject</button></> : null}
              {permissions.has("ai.knowledge.publish") && latest?.version_status === "approved" ? <button type="button" className="ci-button ci-button-primary" disabled={busy} onClick={() => onPublish(latest.id)}>Publish approved version</button> : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function KnowledgePanel({ permissions }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_KNOWLEDGE_FORM });
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(null);
  const [detailError, setDetailError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (signal) => {
    setLoading(true); setError("");
    try { setItems(await listAiKnowledge({}, { signal })); }
    catch (requestError) { if (!signal?.aborted) setError(aiErrorMessage(requestError)); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);

  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load]);

  async function createDraft(event) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      await createAiKnowledgeDraft({ ...form, effective_from: form.effective_from || null, expires_at: form.expires_at || null });
      setForm({ ...EMPTY_KNOWLEDGE_FORM }); setFormOpen(false); await load();
    } catch (requestError) { setError(aiErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  async function openDetails(sourceId) {
    setDetailError("");
    try { setSelected(await getAiKnowledgeSource(sourceId)); }
    catch (requestError) { setDetailError(aiErrorMessage(requestError)); }
  }

  async function refreshSelected() {
    if (!selected?.source?.id) return;
    setSelected(await getAiKnowledgeSource(selected.source.id)); await load();
  }

  async function workflow(operation) {
    setBusy(true); setDetailError("");
    try { await operation(); await refreshSelected(); }
    catch (requestError) { setDetailError(aiErrorMessage(requestError)); }
    finally { setBusy(false); }
  }

  return (
    <section className="ci-page">
      <header className="ci-page-heading">
        <div><span className="ci-eyebrow">Approved evidence only</span><h1>Knowledge governance</h1><p>Draft, independently review and publish exact knowledge versions used by CHALIN ONE intelligence. Draft and rejected content is never retrieved as evidence.</p></div>
        {permissions.has("ai.knowledge.manage") ? <button className="ci-button ci-button-primary" type="button" onClick={() => setFormOpen(true)}>New knowledge draft</button> : null}
      </header>
      <StatePanel loading={loading} error={error} empty={!loading && !error && items.length === 0}>
        <div className="ci-card-grid">
          {items.map((item) => (
            <article className="ci-card" key={item.source_key}>
              <span className="ci-eyebrow">{humanize(item.source_type)}</span><h2>{item.title}</h2><p>{item.description || "No source description supplied."}</p>
              <div className="ci-card-meta"><span>{humanize(item.visibility)}</span><span>{humanize(item.source_status)}</span>{item.latest_version_status ? <span>Latest: {humanize(item.latest_version_status)}</span> : null}{item.owner_workspace_code ? <span>{humanize(item.owner_workspace_code)}</span> : null}</div>
              <div className="ci-card-actions"><button type="button" className="ci-button ci-button-secondary" onClick={() => openDetails(item.id)}>Open governance record</button></div>
            </article>
          ))}
        </div>
      </StatePanel>
      {formOpen ? <KnowledgeForm form={form} setForm={setForm} saving={saving} error={error} onSubmit={createDraft} onClose={() => setFormOpen(false)} /> : null}
      {selected ? <KnowledgeDetailModal details={selected} permissions={permissions} busy={busy} error={detailError} onClose={() => setSelected(null)} onSubmitReview={(versionId, reviewerId, note) => workflow(() => submitAiKnowledgeVersion(selected.source.id, versionId, { assignedTo: reviewerId, note }))} onDecision={(approvalId, decision, note) => workflow(() => decideAiKnowledgeApproval(approvalId, decision, note))} onPublish={(versionId) => workflow(() => publishAiKnowledgeVersion(selected.source.id, versionId))} /> : null}
    </section>
  );
}

function UsagePanel() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    listAiUsage({ days: 30 }, { signal: controller.signal }).then(setRows).catch((requestError) => { if (!controller.signal.aborted) setError(aiErrorMessage(requestError)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const totals = useMemo(() => rows.reduce((summary, row) => ({ requests: summary.requests + Number(row.request_count || 0), tokens: summary.tokens + Number(row.total_tokens || 0), cost: summary.cost + Number(row.cost_micros || 0) }), { requests: 0, tokens: 0, cost: 0 }), [rows]);

  return (
    <section className="ci-page">
      <header className="ci-page-heading"><div><span className="ci-eyebrow">Cost and safety visibility</span><h1>Usage ledger</h1><p>Review scoped provider requests, token totals and integer-micro cost evidence. Provider secrets are never exposed here.</p></div></header>
      <div className="ci-card-grid" style={{ marginBottom: 18 }}><article className="ci-card"><span className="ci-eyebrow">Requests</span><h2>{totals.requests.toLocaleString("en-GH")}</h2></article><article className="ci-card"><span className="ci-eyebrow">Tokens</span><h2>{totals.tokens.toLocaleString("en-GH")}</h2></article><article className="ci-card"><span className="ci-eyebrow">Cost micros</span><h2>{totals.cost.toLocaleString("en-GH")}</h2></article></div>
      <StatePanel loading={loading} error={error} empty={!loading && !error && rows.length === 0}>
        <div className="ci-usage-table"><table><thead><tr><th>Date</th><th>Provider</th><th>Model</th><th>Requests</th><th>Input</th><th>Output</th><th>Cost micros</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.usage_date}-${row.provider_key}-${row.model_key}-${index}`}><td>{formatDate(row.usage_date)}</td><td>{row.provider_key}</td><td>{row.model_key}</td><td>{Number(row.request_count || 0).toLocaleString("en-GH")}</td><td>{Number(row.input_tokens || 0).toLocaleString("en-GH")}</td><td>{Number(row.output_tokens || 0).toLocaleString("en-GH")}</td><td>{Number(row.cost_micros || 0).toLocaleString("en-GH")}</td></tr>)}</tbody></table></div>
      </StatePanel>
    </section>
  );
}

export default function ChalinIntelligenceWorkspace() {
  const { user, workspaceName, workspaceCode } = useAuth();
  const [status, setStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState("");
  const [persona, setPersona] = useState(AI_PERSONAS.copilot);
  const [tab, setTab] = useState("chat");
  const [conversations, setConversations] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationError, setConversationError] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [tools, setTools] = useState([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatSettings, setChatSettings] = useState(loadAiChatPreferences);
  const [conversationAction, setConversationAction] = useState(null);
  const [conversationActionBusy, setConversationActionBusy] = useState(false);
  const [clearHistoryOpen, setClearHistoryOpen] = useState(false);
  const [clearHistoryBusy, setClearHistoryBusy] = useState(false);
  const activePersonaRef = useRef(persona);
  const activeChatEpochRef = useRef(0);

  const permissions = useMemo(() => permissionSet(status), [status]);
  const providerActive = status?.provider?.key && status.provider.key !== "disabled";
  const personaAvailable = canUsePersona(status, persona);
  const knowledgeAvailable = permissions.has("ai.knowledge.view");
  const usageAvailable = permissions.has("ai.usage.view");

  useEffect(() => {
    saveAiChatPreferences(chatSettings);
  }, [chatSettings]);

  useEffect(() => {
    const controller = new AbortController();
    getAiStatus({ signal: controller.signal })
      .then((result) => {
        setStatus(result);
        if (!canUsePersona(result, AI_PERSONAS.copilot) && canUsePersona(result, AI_PERSONAS.executive)) setPersona(AI_PERSONAS.executive);
      })
      .catch((error) => { if (!controller.signal.aborted) setStatusError(aiErrorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setStatusLoading(false); });
    return () => controller.abort();
  }, []);

  const loadConversations = useCallback(
    async (signal, { silent = false, force = false } = {}) => {
      if (!status || !canUsePersona(status, persona)) return;
      if (!silent) setConversationLoading(true);
      setConversationError("");
      try {
        const [conversationRows, toolRows] = await Promise.all([
          listAiConversations(persona, {}, { signal, force }),
          listAiTools(persona, { signal, force }),
        ]);
        setConversations(conversationRows);
        setTools(toolRows);
      } catch (error) {
        if (!signal?.aborted) setConversationError(aiErrorMessage(error));
      } finally {
        if (!signal?.aborted && !silent) setConversationLoading(false);
      }
    },
    [persona, status]
  );

  useEffect(() => {
    const controller = new AbortController();
    if (activePersonaRef.current !== persona) {
      activePersonaRef.current = persona;
      activeChatEpochRef.current += 1;
      setConversation(null);
      setMessages([]);
      setSendError("");
    }
    loadConversations(controller.signal);
    return () => controller.abort();
  }, [loadConversations, persona]);

  const openConversation = useCallback(async (item) => {
    if (!item?.key) return;
    const epoch = activeChatEpochRef.current + 1;
    activeChatEpochRef.current = epoch;
    setConversationError("");
    setSendError("");
    try {
      const details = await getAiConversation(persona, item.key);
      if (activeChatEpochRef.current !== epoch) return;
      setConversation(details.conversation);
      setMessages(details.messages || []);
      rememberActiveConversation(persona, workspaceCode, item.key);
      setTab("chat");
    } catch (error) {
      if (activeChatEpochRef.current === epoch) {
        forgetActiveConversation(persona, workspaceCode);
        setConversationError(aiErrorMessage(error));
      }
    }
  }, [persona, workspaceCode]);

  useEffect(() => {
    if (!personaAvailable || conversation || conversationLoading) return;
    const savedKey = readActiveConversation(persona, workspaceCode);
    if (!savedKey) return;
    const savedConversation = conversations.find((item) => item?.key === savedKey);
    if (!savedConversation) {
      if (conversations.length > 0) forgetActiveConversation(persona, workspaceCode);
      return;
    }
    openConversation(savedConversation);
  }, [conversation, conversationLoading, conversations, openConversation, persona, personaAvailable, workspaceCode]);

  function newConversation() {
    activeChatEpochRef.current += 1;
    forgetActiveConversation(persona, workspaceCode);
    setConversation(null);
    setMessages([]);
    setSendError("");
    setTab("chat");
  }

  async function send(message) {
    if (!personaAvailable || sending) return;
    const epoch = activeChatEpochRef.current;
    const startingConversationKey = conversation?.key || null;
    setSending(true);
    setSendError("");
    const optimisticUser = { key: `local-user-${Date.now()}`, role: "user", content: message, safety_status: "pending", created_at: new Date().toISOString() };
    setMessages((current) => [...current, optimisticUser]);
    try {
      const result = await sendAiMessage(persona, { conversationKey: startingConversationKey, message });
      const conversationKey = result.conversation_key;
      const now = new Date().toISOString();
      const assistant = { key: result.message_key, role: "assistant", content: result.answer, safety_status: "allowed", model_key: result.provider?.model, evidence: result.evidence || [], created_at: now, resultMeta: result };
      const nextTitle = result?.conversation?.title || (
        conversation?.title && conversation.title !== "General Conversation"
          ? conversation.title
          : deriveConversationTitle(message)
      );
      const rolledOver = result?.conversation_rollover?.occurred === true;

      setConversations((current) => {
        const existing = current.find((item) => item.key === conversationKey);
        const row = {
          ...(existing || {}),
          key: conversationKey,
          title: nextTitle,
          persona,
          workspace_code: workspaceCode,
          last_message_at: now,
          updated_at: now,
        };
        return [row, ...current.filter((item) => item.key !== conversationKey)];
      });

      if (activeChatEpochRef.current === epoch) {
        rememberActiveConversation(persona, workspaceCode, conversationKey);
        setConversation((current) => current
          ? { ...current, key: conversationKey, title: nextTitle }
          : { key: conversationKey, title: nextTitle, persona, workspace_code: workspaceCode });

        if (rolledOver) {
          try {
            const details = await getAiConversation(persona, conversationKey);
            if (activeChatEpochRef.current === epoch) {
              setConversation(details?.conversation || { key: conversationKey, title: nextTitle, persona, workspace_code: workspaceCode });
              setMessages(details?.messages || [optimisticUser, assistant]);
            }
          } catch {
            if (activeChatEpochRef.current === epoch) {
              setMessages([optimisticUser, assistant]);
            }
          }
        } else {
          setMessages((current) => [...current, assistant]);
        }
      }

      loadConversations(undefined, { silent: true, force: true });
    } catch (error) {
      if (activeChatEpochRef.current === epoch) setSendError(aiErrorMessage(error));
    } finally {
      setSending(false);
    }
  }

  async function confirmConversationAction(nextTitle) {
    const action = conversationAction;
    if (!action?.item?.key || conversationActionBusy) return;
    setConversationActionBusy(true);
    setConversationError("");
    try {
      if (action.mode === "rename") {
        const title = String(nextTitle || "").trim();
        if (!title) return;
        await renameAiConversation(persona, action.item.key, title);
        setConversations((current) => current.map((item) => item.key === action.item.key ? { ...item, title } : item));
        if (conversation?.key === action.item.key) setConversation((current) => current ? { ...current, title } : current);
      } else {
        await deleteAiConversation(persona, action.item.key);
        setConversations((current) => current.filter((item) => item.key !== action.item.key));
        if (conversation?.key === action.item.key) newConversation();
      }
      setConversationAction(null);
      loadConversations(undefined, { silent: true, force: true });
    } catch (error) {
      setConversationError(aiErrorMessage(error));
    } finally {
      setConversationActionBusy(false);
    }
  }

  async function confirmClearHistory() {
    if (clearHistoryBusy) return;
    setClearHistoryBusy(true);
    setConversationError("");
    try {
      await clearAiConversationHistory(persona);
      activeChatEpochRef.current += 1;
      forgetActiveConversation(persona, workspaceCode);
      setConversations([]);
      setConversation(null);
      setMessages([]);
      setSendError("");
      setClearHistoryOpen(false);
      setSettingsOpen(false);
      await loadConversations(undefined, { silent: true, force: true });
    } catch (error) {
      setConversationError(aiErrorMessage(error));
      setClearHistoryOpen(false);
    } finally {
      setClearHistoryBusy(false);
    }
  }

  if (statusLoading) return <main className="ci-shell ci-shell-loading"><StatePanel loading /></main>;
  if (statusError || !status) return <main className="ci-shell ci-shell-loading"><div><StatePanel error={statusError || "The intelligence status could not be verified."} /><p style={{ textAlign: "center" }}><Link to="/">Return to the staff system</Link></p></div></main>;

  return (
    <main className="ci-shell">
      <header className="ci-topbar">
        <div className="ci-brand">
          <span className="ci-brand-mark" aria-hidden="true">C1</span>
          <span className="ci-brand-copy"><strong>CHALIN Intelligence</strong><small>{user?.full_name || user?.username || "Authorized staff"}</small></span>
        </div>
        <div className="ci-topbar-actions">
          <span className="ci-scope-pill">{workspaceName || humanize(workspaceCode)}</span>
          <span className="ci-provider-pill" data-active={providerActive ? "true" : "false"}>{status.provider?.key || "disabled"}{status.provider?.model_key ? ` · ${status.provider.model_key}` : ""}</span>
          <Link className="ci-button ci-button-secondary" to="/">Staff system</Link>
        </div>
      </header>
      {!providerActive ? <div className="ci-banner ci-provider-warning" role="status">No usable provider is active for Copilot. Open Provider Control to select CHALIN Local or a configured external provider.</div> : null}
      <div className="ci-workspace">
        <aside className="ci-sidebar">
          <div className="ci-sidebar-head">
            <button type="button" className="ci-new-chat" onClick={newConversation} disabled={!personaAvailable}><span aria-hidden="true">＋</span> New chat</button>
            <div className="ci-persona-switch" aria-label="Intelligence persona">
              <button type="button" aria-pressed={persona === AI_PERSONAS.copilot} disabled={!canUsePersona(status, AI_PERSONAS.copilot)} onClick={() => setPersona(AI_PERSONAS.copilot)}>Copilot</button>
              <button type="button" aria-pressed={persona === AI_PERSONAS.executive} disabled={!canUsePersona(status, AI_PERSONAS.executive)} onClick={() => setPersona(AI_PERSONAS.executive)}>Executive</button>
            </div>
          </div>
          <div className="ci-sidebar-section">
            <div className="ci-sidebar-section-head">
              <span className="ci-sidebar-label">Chats</span>
              {conversationLoading && conversations.length > 0 ? <small>Updating</small> : null}
            </div>
            {conversationError ? <div className="ci-banner ci-banner-danger">{conversationError}</div> : null}
            {conversationLoading && conversations.length === 0 ? <div className="ci-sidebar-skeleton" aria-label="Loading conversations"><span /><span /><span /></div> : (
              <div className="ci-conversation-list">
                {conversations.map((item) => (
                  <ConversationRow
                    key={item.key}
                    item={item}
                    active={conversation?.key === item.key}
                    onOpen={openConversation}
                    onRename={(target) => setConversationAction({ mode: "rename", item: target })}
                    onDelete={(target) => setConversationAction({ mode: "delete", item: target })}
                  />
                ))}
                {conversations.length === 0 ? <div className="ci-sidebar-empty">No saved chats yet.</div> : null}
              </div>
            )}
          </div>
          <div className="ci-sidebar-footer">
            <div><span className="ci-sidebar-label">Available context</span><p>{tools.length} permission-scoped tool{tools.length === 1 ? "" : "s"}</p></div>
            <button type="button" className="ci-sidebar-settings" onClick={() => setSettingsOpen(true)}><span aria-hidden="true">⚙</span> Settings</button>
          </div>
        </aside>
        <section className="ci-main">
          <div className="ci-tabs" role="tablist" aria-label="Intelligence workspace">
            <button type="button" role="tab" aria-selected={tab === "chat"} onClick={() => setTab("chat")}>Chat</button>
            <button type="button" role="tab" aria-selected={tab === "knowledge"} disabled={!knowledgeAvailable} onClick={() => setTab("knowledge")}>Knowledge</button>
            <button type="button" role="tab" aria-selected={tab === "usage"} disabled={!usageAvailable} onClick={() => setTab("usage")}>Usage</button>
          </div>
          <div className="ci-panel" role="tabpanel">
            {tab === "chat" ? personaAvailable ? (
              <ChatPanel
                persona={persona}
                conversation={conversation}
                messages={messages}
                sending={sending}
                error={sendError}
                onSend={send}
                onStarter={send}
                settings={chatSettings}
                onOpenSettings={() => setSettingsOpen(true)}
                draftKey={`${workspaceCode}:${persona}:${conversation?.key || "new"}`}
              />
            ) : <div className="ci-page"><StatePanel error={`The ${humanize(persona)} persona is disabled or not granted to this account.`} /></div> : null}
            {tab === "knowledge" && knowledgeAvailable ? <KnowledgePanel permissions={permissions} /> : null}
            {tab === "usage" && usageAvailable ? <UsagePanel /> : null}
          </div>
        </section>
      </div>
      {settingsOpen ? <ChatSettingsModal settings={chatSettings} setSettings={setChatSettings} provider={status.provider} historyCount={conversations.length} onRequestClearHistory={() => setClearHistoryOpen(true)} onClose={() => setSettingsOpen(false)} /> : null}
      {clearHistoryOpen ? <ClearHistoryDialog persona={persona} busy={clearHistoryBusy} onClose={() => !clearHistoryBusy && setClearHistoryOpen(false)} onConfirm={confirmClearHistory} /> : null}
      {conversationAction ? <ConversationActionDialog action={conversationAction} busy={conversationActionBusy} onClose={() => !conversationActionBusy && setConversationAction(null)} onConfirm={confirmConversationAction} /> : null}
    </main>
  );
}
