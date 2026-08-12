"use strict";

const DOCUMENT_ACTION_PATTERN = /\b(?:generate|create|make|prepare|export|download|produce|build|give me|put together|turn into)\b/i;
const DOCUMENT_NOUN_PATTERN = /\b(?:document|report|statement|file|spreadsheet|workbook|pdf|word|docx|excel|xlsx|csv)\b/i;
const DOCUMENT_TOPIC_PATTERN = /\b(?:sales?|stock|inventory|debts?|collections?|customers?|expenses?|payroll|salary|audit|mining|production|hire|finance|arrears|payments?|profit|performance|operations?)\b/i;
const FORMAT_PATTERN = /\b(?:pdf|word|docx|excel|xlsx|spreadsheet|csv)\b/i;
const PERIOD_PATTERN = /\b(?:today|yesterday|this\s+week|last\s+week|this\s+month|last\s+month|this\s+year|last\s+year|current(?:ly)?|right\s+now|from\s+\d{4}-\d{2}-\d{2}|to\s+\d{4}-\d{2}-\d{2}|\d{4}-\d{2}-\d{2})\b/i;
const TIME_BOUND_TOPIC_PATTERN = /\b(?:sales?|stock|inventory|debts?|collections?|expenses?|payroll|salary|audit|mining|production|hire|finance|arrears|payments?|profit|performance|operations?)\b/i;

function clean(value, maximum = 12000) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function isDocumentRequest(value) {
  const text = clean(value);
  if (!text) return false;
  if (DOCUMENT_ACTION_PATTERN.test(text) && DOCUMENT_NOUN_PATTERN.test(text)) return true;
  return (
    DOCUMENT_ACTION_PATTERN.test(text) &&
    DOCUMENT_TOPIC_PATTERN.test(text) &&
    /\b(?:report|document|spreadsheet|pdf|word|excel|csv)\b/i.test(text)
  );
}

function requestedFormat(value) {
  const text = clean(value, 4000);
  if (/\bpdf\b/i.test(text)) return "pdf";
  if (/\b(?:word|docx)\b/i.test(text)) return "docx";
  if (/\b(?:excel|xlsx|spreadsheet)\b/i.test(text)) return "xlsx";
  if (/\bcsv\b/i.test(text)) return "csv";
  return null;
}

function buildClarificationRequest({ prompt } = {}) {
  const text = clean(prompt);
  if (!isDocumentRequest(text)) return null;

  const missing = [];
  if (!FORMAT_PATTERN.test(text)) missing.push("format");
  if (TIME_BOUND_TOPIC_PATTERN.test(text) && !PERIOD_PATTERN.test(text)) {
    missing.push("period");
  }
  if (missing.length === 0) return null;

  let answer;
  if (missing.includes("format") && missing.includes("period")) {
    answer =
      "Yes — I can prepare that. Which format do you want: PDF, Word, Excel, or CSV? And what period should I use: today, yesterday, this week, this month, or custom dates? I’ll use your current authorized workspace/store unless you name another one.";
  } else if (missing.includes("format")) {
    answer =
      "Yes — I can prepare that. Which format do you want: PDF, Word, Excel, or CSV? I’ll keep the period and authorized business scope you already specified.";
  } else {
    answer =
      "Yes — I can prepare that document. What period should I use: today, yesterday, this week, this month, or custom dates? I’ll keep the format and current authorized workspace/store you already specified.";
  }

  return Object.freeze({
    kind: "document_generation",
    answer,
    missing_fields: Object.freeze(missing),
    requested_format: requestedFormat(text),
    source_of_truth: false,
    execution_authority: false,
    requires_provider: false,
  });
}

module.exports = {
  buildClarificationRequest,
  isDocumentRequest,
  requestedFormat,
};
