"use strict";

const { GHANA_TIME_ZONE } = require("./sessionExpiryPolicy");

const CURRENT_DATE_PROMPTS = new Set([
  "what is todays date",
  "whats todays date",
  "what is today date",
  "what is the date today",
  "whats the date today",
  "what date is it today",
  "what date is it",
  "todays date",
  "todays date please",
  "tell me todays date",
  "please tell me todays date",
  "can you tell me todays date",
  "what day is it",
  "what day is it today",
]);

function normalizeUtilityPrompt(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\btodyas\b/g, "todays")
    .replace(/\btodays\b/g, "todays")
    .replace(/today's/g, "todays")
    .replace(/what's/g, "whats")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function validTimeZone(value) {
  const candidate = String(value || "").trim() || GHANA_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date(0));
    return candidate;
  } catch {
    return GHANA_TIME_ZONE;
  }
}

function formatCurrentDate(value, timeZone = GHANA_TIME_ZONE) {
  const now = validDate(value) || new Date();
  const zone = validTimeZone(timeZone);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(now);
}

function localDateKey(value, timeZone = GHANA_TIME_ZONE) {
  const now = validDate(value) || new Date();
  const zone = validTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function isCurrentDatePrompt(value) {
  const normalized = normalizeUtilityPrompt(value);
  return CURRENT_DATE_PROMPTS.has(normalized);
}

function buildDeterministicUtilityRequest({
  prompt,
  now = new Date(),
  timeZone = GHANA_TIME_ZONE,
} = {}) {
  if (!isCurrentDatePrompt(prompt)) return null;

  const zone = validTimeZone(timeZone);
  const safeNow = validDate(now) || new Date();
  const formatted = formatCurrentDate(safeNow, zone);
  const dateKey = localDateKey(safeNow, zone);

  return Object.freeze({
    kind: "current_date",
    answer: `Today is ${formatted}.`,
    date_key: dateKey,
    time_zone: zone,
    missing_fields: Object.freeze([]),
    requested_format: null,
    period_default: null,
    source_of_truth: true,
    execution_authority: false,
    requires_provider: false,
    server_owned_clock: true,
  });
}

module.exports = {
  CURRENT_DATE_PROMPTS,
  buildDeterministicUtilityRequest,
  formatCurrentDate,
  isCurrentDatePrompt,
  localDateKey,
  normalizeUtilityPrompt,
  validTimeZone,
};
