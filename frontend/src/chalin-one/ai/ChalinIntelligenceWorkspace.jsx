import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import { useAuth } from "../../context/AuthContext";
import {
  AI_PERSONAS,
  aiErrorMessage,
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
    "What needs my attention in this workspace today? Investigate before answering.",
    "Analyze sales, collections and inventory signals and tell me what matters most.",
    "Look for unusual operational patterns or risks I may be missing.",
    "Continue the most relevant work we discussed previously and remind me where we left off.",
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

function ChatMessage({ message, persona, conversationKey, resultMeta = null }) {
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
        {assistant ? (
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

function ChatPanel({ persona, conversation, messages, sending, error, onSend, onStarter }) {
  const [draft, setDraft] = useState("");
  const streamRef = useRef(null);

  useEffect(() => {
    streamRef.current?.scrollTo({
      top: streamRef.current.scrollHeight,
      behavior: sending ? "auto" : "smooth",
    });
  }, [messages, sending]);

  async function submit(event) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;
    setDraft("");
    await onSend(message);
  }

  return (
    <section className="ci-chat-panel">
      <div className="ci-panel ci-chat-stream" ref={streamRef}>
        {conversation?.title ? (
          <div className="ci-chat-title" aria-label="Conversation title">
            <strong>{conversation.title}</strong>
          </div>
        ) : null}
        {messages.length === 0 ? (
          <div className="ci-empty-chat">
            <div>
              <span className="ci-eyebrow">Deep governed intelligence</span>
              <h1>{persona === "executive" ? "Chalin Executive" : "Chalin Copilot"}</h1>
              <p>
                Ask naturally. CHALIN can reason, investigate approved live data, compare evidence, recall relevant prior conversations and explain what matters instead of dumping raw snapshots.
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
            />
          ))
        )}
        {sending ? (
          <div className="ci-thinking" role="status" aria-live="polite">
            <span className="ci-thinking-dot" aria-hidden="true" />
            <strong>CHALIN is thinking and investigating…</strong>
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
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button className="ci-button ci-button-primary" type="submit" disabled={sending || !draft.trim()}>
            {sending ? "Thinking…" : "Send"}
          </button>
        </form>
        <p className="ci-composer-note">
          Conversation history is preserved for continuity. Credentials and unauthorized cross-user data remain excluded; sensitive business actions still require the normal CHALIN controls.
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

  const permissions = useMemo(() => permissionSet(status), [status]);
  const providerActive = status?.provider?.key && status.provider.key !== "disabled";
  const personaAvailable = canUsePersona(status, persona);
  const knowledgeAvailable = permissions.has("ai.knowledge.view");
  const usageAvailable = permissions.has("ai.usage.view");

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
      if (!status || !canUsePersona(status, persona)) {
        setConversations([]);
        return;
      }
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
    setConversation(null); setMessages([]);
    loadConversations(controller.signal);
    return () => controller.abort();
  }, [loadConversations]);

  async function openConversation(item) {
    setConversationError("");
    try {
      const details = await getAiConversation(persona, item.key);
      setConversation(details.conversation); setMessages(details.messages || []); setTab("chat");
    } catch (error) { setConversationError(aiErrorMessage(error)); }
  }

  function newConversation() {
    setConversation(null); setMessages([]); setSendError(""); setTab("chat");
  }

  async function send(message) {
    if (!personaAvailable || sending) return;
    setSending(true); setSendError("");
    const optimisticUser = { key: `local-user-${Date.now()}`, role: "user", content: message, safety_status: "pending", created_at: new Date().toISOString() };
    setMessages((current) => [...current, optimisticUser]);
    try {
      const result = await sendAiMessage(persona, { conversationKey: conversation?.key || null, message });
      const conversationKey = result.conversation_key;
      const assistant = { key: result.message_key, role: "assistant", content: result.answer, safety_status: "allowed", model_key: result.provider?.model, evidence: result.evidence || [], created_at: new Date().toISOString(), resultMeta: result };
      setConversation((current) => current ? { ...current, title: current.title === "General Conversation" ? deriveConversationTitle(message) : current.title } : { key: conversationKey, title: deriveConversationTitle(message), persona, workspace_code: workspaceCode });
      setMessages((current) => [...current, assistant]);
      await loadConversations(undefined, { silent: true, force: true });
    } catch (error) {
      setSendError(aiErrorMessage(error));
    } finally { setSending(false); }
  }

  async function renameCurrent() {
    if (!conversation?.key) return;
    const title = window.prompt("Conversation title", conversation.title || "");
    if (!title?.trim()) return;
    try {
      await renameAiConversation(persona, conversation.key, title.trim());
      setConversation((current) => ({ ...current, title: title.trim() }));
      setConversations((current) => current.map((item) => item.key === conversation.key ? { ...item, title: title.trim() } : item));
      await loadConversations(undefined, { silent: true, force: true });
    } catch (error) { setConversationError(aiErrorMessage(error)); }
  }

  async function deleteCurrent() {
    if (!conversation?.key) return;
    const title = conversation.title || "this conversation";
    if (!window.confirm(`Delete “${title}” permanently? This removes the conversation and its chat messages.`)) return;
    try {
      const key = conversation.key;
      await deleteAiConversation(persona, key);
      setConversations((current) => current.filter((item) => item.key !== key));
      newConversation();
      await loadConversations(undefined, { silent: true, force: true });
    } catch (error) { setConversationError(aiErrorMessage(error)); }
  }

  if (statusLoading) return <main className="ci-shell" style={{ display: "grid", placeItems: "center" }}><StatePanel loading /></main>;
  if (statusError || !status) return <main className="ci-shell" style={{ display: "grid", placeItems: "center", padding: 20 }}><div><StatePanel error={statusError || "The intelligence status could not be verified."} /><p style={{ textAlign: "center" }}><Link to="/">Return to the staff system</Link></p></div></main>;

  return (
    <main className="ci-shell">
      <header className="ci-topbar">
        <div className="ci-brand"><span className="ci-brand-mark" aria-hidden="true">C1</span><span className="ci-brand-copy"><strong>CHALIN ONE Intelligence</strong><small>{user?.full_name || user?.username || "Authorized staff"}</small></span></div>
        <div className="ci-topbar-actions">
          <span className="ci-scope-pill">{workspaceName || humanize(workspaceCode)}</span>
          <span className="ci-provider-pill" data-active={providerActive ? "true" : "false"}>Provider: {status.provider?.key || "disabled"}{status.provider?.model_key ? ` · ${status.provider.model_key}` : ""}</span>
          <span className="ci-status-pill" data-state={status.ai_actions_enabled ? "danger" : "success"}>{status.ai_actions_enabled ? "Approved actions enabled" : "Read / recommend / prepare only"}</span>
          <Link className="ci-button ci-button-secondary" to="/">Staff system</Link>
        </div>
      </header>
      {!providerActive ? <div className="ci-banner" role="status" style={{ marginInline: 16 }}>No usable provider is active for Copilot. Open Provider Control to select CHALIN Local or a configured external provider.</div> : null}
      <div className="ci-workspace">
        <aside className="ci-sidebar">
          <div className="ci-sidebar-head">
            <button type="button" className="ci-button ci-button-primary ci-new-chat" onClick={newConversation} disabled={!personaAvailable}>New chat</button>
            <div className="ci-persona-switch" aria-label="Intelligence persona">
              <button type="button" aria-pressed={persona === AI_PERSONAS.copilot} disabled={!canUsePersona(status, AI_PERSONAS.copilot)} onClick={() => setPersona(AI_PERSONAS.copilot)}>Copilot</button>
              <button type="button" aria-pressed={persona === AI_PERSONAS.executive} disabled={!canUsePersona(status, AI_PERSONAS.executive)} onClick={() => setPersona(AI_PERSONAS.executive)}>Executive</button>
            </div>
          </div>
          <div className="ci-sidebar-section">
            <span className="ci-sidebar-label">Conversations</span>
            {conversationError ? <div className="ci-banner ci-banner-danger">{conversationError}</div> : null}
            {conversationLoading && conversations.length === 0 ? <div className="ci-state">Loading conversations…</div> : (
              <div className="ci-conversation-list">
                {conversationLoading ? <small className="ci-sync-label">Syncing…</small> : null}
                {conversations.map((item) => <button type="button" className="ci-conversation-item" key={item.key} aria-current={conversation?.key === item.key ? "true" : undefined} onClick={() => openConversation(item)}><strong>{item.title || "New conversation"}</strong><small>{formatDate(item.last_message_at || item.updated_at, true)}</small></button>)}
                {conversations.length === 0 ? <div className="ci-state"><span>No saved conversations.</span></div> : null}
              </div>
            )}
          </div>
          <div className="ci-sidebar-footer">
            <span className="ci-sidebar-label">Intelligence tools</span>
            <p style={{ fontSize: ".72rem", color: "var(--ci-slate-700)" }}>{tools.length} permission-scoped read tool{tools.length === 1 ? "" : "s"} available.</p>
            {conversation?.key ? <div className="ci-card-actions"><button type="button" className="ci-button ci-button-secondary" onClick={renameCurrent}>Rename</button><button type="button" className="ci-button ci-button-danger" onClick={deleteCurrent}>Delete</button></div> : null}
          </div>
        </aside>
        <section className="ci-main">
          <div className="ci-tabs" role="tablist" aria-label="Intelligence workspace">
            <button type="button" role="tab" aria-selected={tab === "chat"} onClick={() => setTab("chat")}>Conversation</button>
            <button type="button" role="tab" aria-selected={tab === "knowledge"} disabled={!knowledgeAvailable} onClick={() => setTab("knowledge")}>Knowledge</button>
            <button type="button" role="tab" aria-selected={tab === "usage"} disabled={!usageAvailable} onClick={() => setTab("usage")}>Usage</button>
          </div>
          <div className="ci-panel" role="tabpanel">
            {tab === "chat" ? personaAvailable ? <ChatPanel persona={persona} conversation={conversation} messages={messages} sending={sending} error={sendError} onSend={send} onStarter={send} /> : <div className="ci-page"><StatePanel error={`The ${humanize(persona)} persona is disabled or not granted to this account.`} /></div> : null}
            {tab === "knowledge" && knowledgeAvailable ? <KnowledgePanel permissions={permissions} /> : null}
            {tab === "usage" && usageAvailable ? <UsagePanel /> : null}
          </div>
        </section>
      </div>
    </main>
  );
}
