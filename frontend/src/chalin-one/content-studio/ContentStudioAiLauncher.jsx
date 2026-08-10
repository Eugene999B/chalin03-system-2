import { useEffect, useMemo, useRef, useState } from "react";
import { useFeatureFlags } from "../../context/FeatureFlagContext";
import {
  askContentStudioAi,
  contentStudioAiErrorMessage,
  getContentStudioAiStatus,
} from "./contentStudioAiApi";
import "./contentStudioAi.css";

const QUICK_QUESTIONS = Object.freeze([
  "What needs attention before publishing?",
  "Summarize the review and approval backlog.",
  "What should I check before the next publish?",
]);
const PAGES_QUESTION = "How healthy is the website for SEO and navigation?";

function providerLabel(provider = {}) {
  const effective = String(provider.effective || "local").toLowerCase();
  if (effective === "gemini") return "Gemini";
  if (effective === "openai") return "OpenAI";
  return "CHALIN Local";
}

function selectedProviderLabel(provider = {}) {
  const selected = String(provider.selected || provider.effective || "local").toLowerCase();
  if (selected === "gemini") return "Gemini";
  if (selected === "openai") return "OpenAI";
  return "CHALIN Local";
}

function ProviderNotice({ provider }) {
  if (!provider) return null;
  const selected = selectedProviderLabel(provider);
  const effective = providerLabel(provider);
  const fallback = selected !== effective;
  return (
    <div className="cs-ai-provider-note">
      <span>{effective}</span>
      {fallback ? <small>{selected} selected · privacy routed to {effective}</small> : null}
      {!fallback ? <small>internal aggregate evidence · read-only</small> : null}
    </div>
  );
}

function EvidenceList({ evidence = [] }) {
  if (!Array.isArray(evidence) || evidence.length === 0) return null;
  return (
    <details className="cs-ai-evidence">
      <summary>{evidence.length} governed evidence source{evidence.length === 1 ? "" : "s"}</summary>
      <div>
        {evidence.map((item) => (
          <article key={`${item.citation || "E"}-${item.source_ref}`}>
            <strong>{item.citation ? `[${item.citation}] ` : ""}{item.label}</strong>
            <span>{item.source_version || "live read-only"}</span>
          </article>
        ))}
      </div>
    </details>
  );
}

export default function ContentStudioAiLauncher() {
  const { flags, loading: flagsLoading } = useFeatureFlags();
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState("");
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState(QUICK_QUESTIONS[0]);
  const [answer, setAnswer] = useState(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef(null);

  const enabled = flags?.aiEnabled === true && flags?.chalinCopilot === true;

  useEffect(() => {
    if (flagsLoading || !enabled) return undefined;
    const controller = new AbortController();
    setStatusError("");
    getContentStudioAiStatus({ signal: controller.signal })
      .then((next) => {
        if (!controller.signal.aborted) setStatus(next);
      })
      .catch((nextError) => {
        if (!controller.signal.aborted) {
          setStatus(null);
          setStatusError(contentStudioAiErrorMessage(nextError));
        }
      });
    return () => controller.abort();
  }, [enabled, flagsLoading]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const quickQuestions = useMemo(
    () => (status?.pages_scope ? [...QUICK_QUESTIONS, PAGES_QUESTION] : [...QUICK_QUESTIONS]),
    [status?.pages_scope]
  );

  if (flagsLoading || !enabled || (!status && statusError)) return null;

  async function ask(nextQuestion = question) {
    const cleanQuestion = String(nextQuestion || "").trim();
    if (!cleanQuestion || asking) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setQuestion(cleanQuestion);
    setAsking(true);
    setError("");
    try {
      const result = await askContentStudioAi(cleanQuestion, { signal: controller.signal });
      if (!controller.signal.aborted) setAnswer(result);
    } catch (askError) {
      if (!controller.signal.aborted) setError(contentStudioAiErrorMessage(askError));
    } finally {
      if (!controller.signal.aborted) setAsking(false);
    }
  }

  return (
    <aside className={`cs-ai-shell ${open ? "is-open" : ""}`} aria-label="CHALIN Content Studio Intelligence">
      {open ? (
        <section className="cs-ai-panel" role="dialog" aria-label="CHALIN Studio intelligence">
          <header className="cs-ai-header">
            <div>
              <span>CHALIN STUDIO</span>
              <strong>Publishing intelligence</strong>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close CHALIN Studio">×</button>
          </header>

          <ProviderNotice provider={answer?.provider || status?.provider} />

          <div className="cs-ai-quick" aria-label="Suggested Content Studio questions">
            {quickQuestions.map((item) => (
              <button key={item} type="button" onClick={() => ask(item)} disabled={asking}>
                {item}
              </button>
            ))}
          </div>

          <form
            className="cs-ai-form"
            onSubmit={(event) => {
              event.preventDefault();
              ask(question);
            }}
          >
            <label htmlFor="cs-ai-question">Ask about governed publishing health</label>
            <textarea
              id="cs-ai-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value.slice(0, 1800))}
              rows={3}
              placeholder="What needs attention before publishing?"
            />
            <button type="submit" disabled={asking || !question.trim()}>
              {asking ? "Reading governed evidence…" : "Ask CHALIN"}
            </button>
          </form>

          {error ? <div className="cs-ai-error" role="alert">{error}</div> : null}

          {answer?.answer ? (
            <section className="cs-ai-answer" aria-live="polite">
              <span>READ-ONLY ANSWER</span>
              <p>{answer.answer}</p>
              <EvidenceList evidence={answer.evidence} />
              <small>
                Aggregate Content Studio evidence only. CHALIN cannot approve, publish, edit or archive content from this assistant.
              </small>
            </section>
          ) : (
            <section className="cs-ai-empty">
              <strong>Ask before you publish.</strong>
              <p>
                CHALIN reads the Studio lifecycle and, when your role allows Pages, aggregate website-control health. It does not read form-submission contents or draft page bodies here.
              </p>
            </section>
          )}
        </section>
      ) : null}

      <button
        type="button"
        className="cs-ai-launcher"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="Open CHALIN Content Studio Intelligence"
      >
        <span>AI</span>
        <strong>CHALIN Studio</strong>
      </button>
    </aside>
  );
}
