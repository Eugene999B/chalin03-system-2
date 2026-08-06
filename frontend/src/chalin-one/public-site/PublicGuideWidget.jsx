import { useEffect, useRef, useState } from "react";
import {
  createGuideSession,
  publicGuideErrorMessage,
  sendGuideMessage,
  submitGuideHandoff,
} from "./publicGuideApi";
import "./publicGuide.css";

const STARTERS = Object.freeze([
  "What services does CHALIN 03 publicly offer?",
  "How can I enquire about equipment hire?",
  "Where can I find published vacancies or tenders?",
  "How do I contact the appropriate CHALIN 03 team?",
]);

const EMPTY_HANDOFF = Object.freeze({
  full_name: "",
  email: "",
  phone: "",
  company_name: "",
  service_interest: "General company enquiry",
  subject: "Chalin Guide handoff",
  message: "",
  preferred_contact_method: "Either",
  consent_given: false,
});

function Evidence({ items = [] }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div className="pg-guide-evidence" aria-label="Published evidence">
      {items.map((item, index) => (
        <details key={`${item.source_type}-${item.source_ref}-${index}`}>
          <summary>
            [{item.citation || `E${index + 1}`}] {item.label}
          </summary>
          <div>
            {item.excerpt_text || "Published source reference"}
            {item.as_of_at ? `\nAs of ${new Date(item.as_of_at).toLocaleDateString("en-GH")}` : ""}
          </div>
        </details>
      ))}
    </div>
  );
}

function HandoffForm({ sessionToken, defaultMessage, onComplete, onCancel }) {
  const [form, setForm] = useState({
    ...EMPTY_HANDOFF,
    message: defaultMessage || "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await submitGuideHandoff(sessionToken, {
        ...form,
        source_url: window.location.href,
        consent_text_version: "privacy-v1",
      });
      onComplete(result);
    } catch (requestError) {
      setError(publicGuideErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="pg-guide-handoff" onSubmit={submit}>
      <h2>Send a secure enquiry</h2>
      <p>
        Chalin Guide cannot access private records. This sends a traceable enquiry to the protected Enquiry Desk.
      </p>
      {error ? <div className="pg-guide-state pg-guide-state-error">{error}</div> : null}
      <label>
        Full name
        <input
          value={form.full_name}
          onChange={(event) =>
            setForm((current) => ({ ...current, full_name: event.target.value }))
          }
        />
      </label>
      <label>
        Email
        <input
          type="email"
          value={form.email}
          onChange={(event) =>
            setForm((current) => ({ ...current, email: event.target.value }))
          }
        />
      </label>
      <label>
        Phone
        <input
          type="tel"
          value={form.phone}
          onChange={(event) =>
            setForm((current) => ({ ...current, phone: event.target.value }))
          }
        />
      </label>
      <label>
        Service
        <select
          value={form.service_interest}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              service_interest: event.target.value,
            }))
          }
        >
          {[
            "Spare Parts",
            "Mining Operations",
            "Equipment Hire",
            "Equipment Sales",
            "Installment Finance",
            "General company enquiry",
          ].map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>
      <label>
        Enquiry
        <textarea
          required
          maxLength={2000}
          value={form.message}
          onChange={(event) =>
            setForm((current) => ({ ...current, message: event.target.value }))
          }
        />
      </label>
      <label>
        Preferred contact
        <select
          value={form.preferred_contact_method}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              preferred_contact_method: event.target.value,
            }))
          }
        >
          <option>Either</option>
          <option>Phone</option>
          <option>Email</option>
        </select>
      </label>
      <label className="pg-guide-consent">
        <input
          type="checkbox"
          required
          checked={form.consent_given}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              consent_given: event.target.checked,
            }))
          }
        />
        <span>
          I consent to CHALIN 03 using this information to review and respond to my enquiry.
        </span>
      </label>
      <div className="pg-guide-actions">
        <button
          className="pg-guide-button"
          type="submit"
          disabled={
            submitting ||
            !form.message.trim() ||
            !form.consent_given ||
            (!form.email.trim() && !form.phone.trim())
          }
        >
          {submitting ? "Sending…" : "Send enquiry"}
        </button>
        <button
          className="pg-guide-button pg-guide-button-secondary"
          type="button"
          onClick={onCancel}
          disabled={submitting}
        >
          Back
        </button>
      </div>
    </form>
  );
}

export default function PublicGuideWidget() {
  const [open, setOpen] = useState(false);
  const [sessionToken, setSessionToken] = useState("");
  const [sessionKey, setSessionKey] = useState("");
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [handoff, setHandoff] = useState(false);
  const [handoffMessage, setHandoffMessage] = useState("");
  const [handoffResult, setHandoffResult] = useState(null);
  const streamRef = useRef(null);

  useEffect(() => {
    if (!open || sessionToken || loading) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    createGuideSession({ signal: controller.signal })
      .then((result) => {
        setSessionToken(result.session_token);
        setSessionKey(result.session_key);
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) {
          setError(publicGuideErrorMessage(requestError));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [loading, open, sessionToken]);

  useEffect(() => {
    if (!open) return;
    streamRef.current?.scrollTo({
      top: streamRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading, open, handoff]);

  function close() {
    setOpen(false);
    setHandoff(false);
  }

  async function ask(message) {
    const question = String(message || "").trim();
    if (!question || !sessionToken || loading) return;
    setDraft("");
    setError("");
    setLoading(true);
    const userMessage = {
      key: `local-${Date.now()}`,
      role: "user",
      content: question,
      evidence: [],
    };
    setMessages((current) => [...current, userMessage]);
    try {
      const result = await sendGuideMessage(sessionToken, question);
      setMessages((current) => [
        ...current,
        {
          key: result.message_key,
          role: "assistant",
          content: result.answer,
          evidence: result.evidence || [],
        },
      ]);
      if (result.requires_handoff) {
        setHandoffMessage(question);
      }
    } catch (requestError) {
      setError(publicGuideErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    await ask(draft);
  }

  return (
    <aside className="pg-guide" aria-label="Chalin Guide public assistant">
      <button
        type="button"
        className="pg-guide-launcher"
        aria-expanded={open}
        aria-controls="public-guide-panel"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">C1</span>
        <span>Ask Chalin Guide</span>
      </button>
      {open ? (
        <section
          id="public-guide-panel"
          className="pg-guide-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="public-guide-title"
        >
          <header className="pg-guide-head">
            <span className="pg-guide-head-mark" aria-hidden="true">C1</span>
            <span className="pg-guide-head-copy">
              <strong id="public-guide-title">Chalin Guide</strong>
              <small>Published public information only</small>
            </span>
            <button
              type="button"
              className="pg-guide-close"
              aria-label="Close Chalin Guide"
              onClick={close}
            >
              ×
            </button>
          </header>
          <div className="pg-guide-boundary">
            I cannot access private accounts, payments, applications, staff records or identity documents. Private enquiries are handed to an authorized human team.
          </div>
          <div className="pg-guide-stream" ref={streamRef}>
            {handoffResult ? (
              <div className="pg-guide-state">
                <strong>Enquiry received</strong>
                <span>{handoffResult.confirmation_message}</span>
                {handoffResult.reference_code ? (
                  <span>Reference: {handoffResult.reference_code}</span>
                ) : null}
              </div>
            ) : handoff ? (
              <HandoffForm
                sessionToken={sessionToken}
                defaultMessage={handoffMessage}
                onComplete={setHandoffResult}
                onCancel={() => setHandoff(false)}
              />
            ) : messages.length === 0 ? (
              <div className="pg-guide-empty">
                <h2>How can I help?</h2>
                <p>
                  Ask about approved public services, equipment, opportunities, locations or company information.
                </p>
                <div className="pg-guide-starters">
                  {STARTERS.map((starter) => (
                    <button
                      type="button"
                      key={starter}
                      disabled={!sessionToken || loading}
                      onClick={() => ask(starter)}
                    >
                      {starter}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <article
                  className={`pg-guide-message pg-guide-message-${message.role}`}
                  key={message.key}
                >
                  <strong>{message.role === "assistant" ? "Chalin Guide" : "You"}</strong>
                  <div className="pg-guide-bubble">{message.content}</div>
                  {message.role === "assistant" ? (
                    <Evidence items={message.evidence} />
                  ) : null}
                </article>
              ))
            )}
            {loading ? (
              <div className="pg-guide-state" role="status">
                Checking approved published information…
              </div>
            ) : null}
            {error ? (
              <div className="pg-guide-state pg-guide-state-error" role="alert">
                {error}
              </div>
            ) : null}
            {!handoff && !handoffResult && handoffMessage ? (
              <div className="pg-guide-actions" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="pg-guide-button"
                  onClick={() => setHandoff(true)}
                >
                  Send secure enquiry
                </button>
              </div>
            ) : null}
          </div>
          {!handoff && !handoffResult ? (
            <form className="pg-guide-composer" onSubmit={submit}>
              <textarea
                value={draft}
                maxLength={8000}
                placeholder="Ask about published CHALIN 03 information"
                aria-label="Question for Chalin Guide"
                disabled={!sessionToken || loading}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <button
                className="pg-guide-button"
                type="submit"
                disabled={!sessionToken || loading || !draft.trim()}
              >
                Ask
              </button>
            </form>
          ) : (
            <div className="pg-guide-composer">
              <button
                type="button"
                className="pg-guide-button pg-guide-button-secondary"
                onClick={close}
              >
                Close Guide
              </button>
              <span style={{ fontSize: ".65rem", color: "#748198" }}>
                Session {sessionKey ? sessionKey.slice(-8) : ""}
              </span>
            </div>
          )}
        </section>
      ) : null}
    </aside>
  );
}
