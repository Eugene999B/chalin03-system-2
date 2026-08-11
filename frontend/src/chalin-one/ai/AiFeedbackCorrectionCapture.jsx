import { useEffect, useRef, useState } from "react";
import axiosClient from "../../api/axiosClient";
import {
  generateAndDownloadAiDocument,
  requestedAiDocumentFormat,
} from "./aiDocumentClient";

const NEGATIVE_RATINGS = new Set(["not_helpful", "incorrect"]);

function feedbackPayload(config) {
  const raw = config?.data;
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function isCorrectionCandidate(config) {
  const url = String(config?.url || "");
  if (!url.endsWith("/ai/feedback") && url !== "/ai/feedback") return false;
  const payload = feedbackPayload(config);
  if (!NEGATIVE_RATINGS.has(String(payload.rating || "").toLowerCase())) return false;
  if (String(payload.comment || "").trim() || String(payload.correction || "").trim()) return false;
  return true;
}

function withCorrection(config, { comment = "", correction = "" } = {}) {
  const payload = feedbackPayload(config);
  return {
    ...config,
    data: {
      ...payload,
      comment: String(comment || "").trim() || null,
      correction: String(correction || "").trim() || null,
    },
  };
}

function chatPersonaFromUrl(config) {
  const url = String(config?.url || "");
  const match = url.match(/(?:^|\/)ai\/(copilot|executive)\/chat(?:$|[?#])/i);
  return match?.[1]?.toLowerCase() || null;
}

function documentRequestFromChatResponse(response) {
  const persona = chatPersonaFromUrl(response?.config);
  if (!persona) return null;

  const requestPayload = feedbackPayload(response?.config);
  const format = requestedAiDocumentFormat(requestPayload.message);
  if (!format) return null;

  const result = response?.data?.data ?? response?.data ?? {};
  const conversationKey = String(result?.conversation_key || "").trim();
  const messageKey = String(result?.message_key || "").trim();
  if (!conversationKey || !messageKey) return null;

  return Object.freeze({
    conversationKey,
    messageKey,
    format,
    title: String(result?.conversation?.title || "").trim() || null,
    persona,
  });
}

export default function AiFeedbackCorrectionCapture() {
  const [pending, setPending] = useState(null);
  const [comment, setComment] = useState("");
  const [correction, setCorrection] = useState("");
  const pendingRef = useRef(null);

  useEffect(() => {
    const requestInterceptorId = axiosClient.interceptors.request.use((config) => {
      if (!isCorrectionCandidate(config)) return config;

      return new Promise((resolve) => {
        // Only one feedback request can be awaiting correction at a time in
        // this browser surface. If another arrives, allow the older rating to
        // submit without detail rather than losing either rating.
        if (pendingRef.current?.resolve) {
          pendingRef.current.resolve(pendingRef.current.config);
        }
        const entry = { config, resolve };
        pendingRef.current = entry;
        setPending(entry);
        setComment("");
        setCorrection("");
      });
    });

    const responseInterceptorId = axiosClient.interceptors.response.use(
      (response) => {
        const documentRequest = documentRequestFromChatResponse(response);
        if (documentRequest) {
          // The already-successful chat response must never be hidden by a
          // secondary document-rendering problem. Generate the artifact from
          // the persisted server-owned answer/evidence without delaying chat.
          Promise.resolve()
            .then(() => generateAndDownloadAiDocument(documentRequest))
            .catch((error) => {
              console.warn(
                "CHALIN Intelligence document generation failed after the chat response was saved:",
                error?.message || error
              );
              try {
                window.dispatchEvent(
                  new CustomEvent("chalin03:ai-document-error", {
                    detail: {
                      message:
                        error?.response?.data?.message ||
                        error?.message ||
                        "The answer was saved, but its document could not be generated.",
                    },
                  })
                );
              } catch {
                // The chat result remains successful even without UI notice.
              }
            });
        }
        return response;
      },
      (error) => Promise.reject(error)
    );

    return () => {
      axiosClient.interceptors.request.eject(requestInterceptorId);
      axiosClient.interceptors.response.eject(responseInterceptorId);
      if (pendingRef.current?.resolve) {
        pendingRef.current.resolve(pendingRef.current.config);
      }
      pendingRef.current = null;
    };
  }, []);

  function finish({ includeDetails = true } = {}) {
    const current = pendingRef.current;
    if (!current?.resolve) return;
    pendingRef.current = null;
    setPending(null);
    const nextConfig = includeDetails
      ? withCorrection(current.config, { comment, correction })
      : current.config;
    current.resolve(nextConfig);
    setComment("");
    setCorrection("");
  }

  if (!pending) return null;

  const rating = String(feedbackPayload(pending.config).rating || "").toLowerCase();
  const incorrect = rating === "incorrect";

  return (
    <div
      role="presentation"
      onMouseDown={() => finish({ includeDetails: false })}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10040,
        display: "grid",
        placeItems: "center",
        padding: 18,
        background: "rgba(3, 12, 22, .72)",
        backdropFilter: "blur(8px)",
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="ci-feedback-correction-title"
        onMouseDown={(event) => event.stopPropagation()}
        style={{
          width: "min(620px, 100%)",
          maxHeight: "min(760px, 90vh)",
          overflow: "auto",
          borderRadius: 18,
          border: "1px solid rgba(148, 163, 184, .28)",
          background: "var(--ci-panel, #0b1724)",
          color: "var(--ci-text, #f8fafc)",
          boxShadow: "0 28px 80px rgba(0,0,0,.38)",
          padding: 22,
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", opacity: .68 }}>
          Improve CHALIN Intelligence
        </span>
        <h2 id="ci-feedback-correction-title" style={{ margin: "8px 0 6px", fontSize: 24 }}>
          {incorrect ? "What did CHALIN get wrong?" : "What made this answer unhelpful?"}
        </h2>
        <p style={{ margin: "0 0 18px", lineHeight: 1.55, opacity: .78 }}>
          Your feedback is saved as a reviewed training candidate. CHALIN does not automatically treat a correction as truth; it must be reviewed before it can influence governed knowledge or future system rules.
        </p>

        <label style={{ display: "grid", gap: 7, marginBottom: 14, fontWeight: 750 }}>
          What did CHALIN misunderstand?
          <textarea
            rows={3}
            maxLength={2000}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Example: I was answering the branch question from the previous message, not starting a new topic."
            style={{
              width: "100%",
              boxSizing: "border-box",
              resize: "vertical",
              borderRadius: 12,
              border: "1px solid rgba(148, 163, 184, .35)",
              padding: 12,
              background: "rgba(255,255,255,.06)",
              color: "inherit",
              font: "inherit",
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 7, marginBottom: 18, fontWeight: 750 }}>
          What should the correct answer or behavior be?
          <textarea
            rows={4}
            maxLength={10000}
            value={correction}
            onChange={(event) => setCorrection(event.target.value)}
            placeholder="Example: Continue the previous live-sales question using Main Store as the missing branch, then fetch the authorized figures."
            style={{
              width: "100%",
              boxSizing: "border-box",
              resize: "vertical",
              borderRadius: 12,
              border: "1px solid rgba(148, 163, 184, .35)",
              padding: 12,
              background: "rgba(255,255,255,.06)",
              color: "inherit",
              font: "inherit",
            }}
          />
        </label>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => finish({ includeDetails: false })}
            style={{
              border: "1px solid rgba(148, 163, 184, .35)",
              borderRadius: 10,
              padding: "10px 14px",
              background: "transparent",
              color: "inherit",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Skip details
          </button>
          <button
            type="button"
            onClick={() => finish({ includeDetails: true })}
            disabled={!comment.trim() && !correction.trim()}
            style={{
              border: 0,
              borderRadius: 10,
              padding: "10px 15px",
              background: "#9ee7ff",
              color: "#07182c",
              fontWeight: 900,
              cursor: !comment.trim() && !correction.trim() ? "not-allowed" : "pointer",
              opacity: !comment.trim() && !correction.trim() ? .55 : 1,
            }}
          >
            Submit correction for review
          </button>
        </div>
      </section>
    </div>
  );
}

export {
  NEGATIVE_RATINGS,
  chatPersonaFromUrl,
  documentRequestFromChatResponse,
  feedbackPayload,
  isCorrectionCandidate,
  withCorrection,
};
