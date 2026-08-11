import axiosClient from "../../api/axiosClient";

export const AI_DOCUMENT_FORMATS = Object.freeze(["pdf", "xlsx", "csv", "docx"]);

const DOCUMENT_ACTION_PATTERN = /\b(generate|create|make|prepare|export|download|put|convert|turn|give|save|print)\b/i;
const DOCUMENT_NOUN_PATTERN = /\b(document|report|statement|file|copy|version|pack)\b/i;

export function requestedAiDocumentFormat(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  const explicit = [
    ["pdf", /\bpdf\b/i],
    ["xlsx", /\b(?:xlsx|excel|spreadsheet)\b/i],
    ["csv", /\bcsv\b/i],
    ["docx", /\b(?:docx|word document|microsoft word|word file)\b/i],
  ];

  for (const [format, pattern] of explicit) {
    if (!pattern.test(text)) continue;
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= 4 || DOCUMENT_ACTION_PATTERN.test(text) || DOCUMENT_NOUN_PATTERN.test(text)) {
      return format;
    }
  }
  return null;
}

function filenameFromDisposition(value, fallback) {
  const header = String(value || "");
  const utf8 = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1].replace(/^"|"$/g, ""));
    } catch {
      // Fall through to the ordinary filename form.
    }
  }
  const basic = header.match(/filename="?([^";]+)"?/i);
  return basic?.[1] || fallback;
}

export async function generateAiDocument({
  conversationKey,
  messageKey,
  format,
  title = null,
} = {}) {
  if (!conversationKey || !messageKey || !AI_DOCUMENT_FORMATS.includes(format)) {
    throw new Error("A saved CHALIN answer and supported document format are required.");
  }
  const response = await axiosClient.post(
    "/ai/documents/generate",
    {
      conversation_key: conversationKey,
      message_key: messageKey,
      format,
      title: title || null,
    },
    { responseType: "blob" }
  );
  const extension = format;
  const fallback = `chalin-intelligence-report.${extension}`;
  return Object.freeze({
    blob: response.data,
    filename: filenameFromDisposition(response.headers?.["content-disposition"], fallback),
    sha256: response.headers?.["x-chalin-document-sha256"] || null,
    classification: response.headers?.["x-chalin-document-classification"] || null,
  });
}

export function downloadAiDocumentArtifact(artifact) {
  if (!artifact?.blob) return false;
  const url = URL.createObjectURL(artifact.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = artifact.filename || "chalin-intelligence-report";
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export async function generateAndDownloadAiDocument(input) {
  const artifact = await generateAiDocument(input);
  downloadAiDocumentArtifact(artifact);
  return artifact;
}

export { filenameFromDisposition };
