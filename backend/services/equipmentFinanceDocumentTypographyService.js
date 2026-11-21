"use strict";

// Render Markdown-flavoured legal clauses stored in immutable historical
// snapshots without printing authoring markers like ** or ### in documents.
// This is presentation only: the original source text and SHA are untouched.
function plainDocumentText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1")
    .replace(/\*\*(?=\s|$)/g, "")
    .replace(/^\s*[-*]\s+(?=\S)/gm, "• ")
    .replace(/[\t ]+\n/g, "\n")
    .trim();
}

function documentBlocks(value) {
  const blocks = [];
  let paragraph = [];
  function flush() {
    if (!paragraph.length) return;
    const text = plainDocumentText(paragraph.join(" ").trim());
    if (text) blocks.push({ kind: "body", text });
    paragraph = [];
  }
  for (const raw of String(value ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const isHeading = /^#{1,6}\s+/.test(line) ||
      /^\*\*[^*]{3,}\*\*$/.test(line) ||
      /^\d+(?:\.\d+)*\.\s+\*\*[^*]+\*\*$/.test(line);
    if (isHeading) {
      flush();
      blocks.push({ kind: "heading", text: plainDocumentText(line) });
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

function htmlDocumentTerms(value) {
  function escape(value) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }
  return documentBlocks(value).map((block) =>
    block.kind === "heading"
      ? `<h4 class="finance-legal-heading">${escape(block.text)}</h4>`
      : `<p class="finance-legal-paragraph">${escape(block.text)}</p>`
  ).join("");
}

module.exports = { plainDocumentText, documentBlocks, htmlDocumentTerms };
