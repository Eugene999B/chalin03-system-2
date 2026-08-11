"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SYSTEM_MANIFEST_VERSION = "source-synchronized-v1";
const MAX_TOOL_KEYS = 120;
const MAX_ROUTE_PATHS = 160;

const TOOL_SOURCE_FILES = Object.freeze([
  "backend/ai-tools/foundationTools.js",
  "backend/ai-tools/sparePartsTools.js",
  "backend/ai-tools/customerIdentityTools.js",
  "backend/ai-tools/miningTools.js",
  "backend/ai-tools/hireTools.js",
  "backend/ai-tools/equipmentFinanceTools.js",
]);

const ROUTE_SOURCE_FILES = Object.freeze([
  "frontend/src/App.jsx",
  "frontend/src/chalin-one/chalinOnePathModel.js",
  "frontend/src/chalin-one/ChalinOneStandaloneEntry.jsx",
]);

const WORKSPACE_SUMMARY = Object.freeze([
  "spare_parts",
  "mining",
  "equipment_hire",
  "equipment_installment_finance",
  "people_employment_payroll",
  "content_studio",
  "public_website",
  "chalin_intelligence",
]);

let cachedManifest = null;

function repositoryRoot() {
  return path.resolve(__dirname, "../..");
}

function readText(relativePath, { root = repositoryRoot(), readFile = fs.readFileSync } = {}) {
  try {
    return String(readFile(path.resolve(root, relativePath), "utf8") || "");
  } catch {
    return "";
  }
}

function extractToolKeys(source) {
  const keys = [];
  const pattern = /\bkey\s*:\s*["'`]([a-z0-9_.-]{3,160})["'`]/gi;
  let match;
  while ((match = pattern.exec(String(source || "")))) {
    const value = String(match[1] || "").trim().toLowerCase();
    if (!value || !value.includes(".")) continue;
    if (!keys.includes(value)) keys.push(value);
    if (keys.length >= MAX_TOOL_KEYS) break;
  }
  return keys;
}

function extractRoutePaths(source) {
  const routes = [];
  const patterns = [
    /\bpath\s*=\s*["']([^"']{1,180})["']/g,
    /["'](\/(?:intelligence|content-studio|website|mining|equipment-hire|equipment-installment-finance|staff|workers|reports|audit|products|new-sale|sales-history|daily-closing)[^"']*)["']/g,
  ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(String(source || "")))) {
      const value = String(match[1] || "").trim();
      if (!value || !value.startsWith("/")) continue;
      if (!routes.includes(value)) routes.push(value);
      if (routes.length >= MAX_ROUTE_PATHS) return routes;
    }
  }
  return routes;
}

function buildSystemKnowledgeManifest({ root = repositoryRoot(), readFile = fs.readFileSync } = {}) {
  const toolKeys = [];
  const routePaths = [];
  const sourcesRead = [];

  for (const file of TOOL_SOURCE_FILES) {
    const source = readText(file, { root, readFile });
    if (!source) continue;
    sourcesRead.push(file);
    for (const key of extractToolKeys(source)) {
      if (!toolKeys.includes(key)) toolKeys.push(key);
      if (toolKeys.length >= MAX_TOOL_KEYS) break;
    }
  }

  for (const file of ROUTE_SOURCE_FILES) {
    const source = readText(file, { root, readFile });
    if (!source) continue;
    sourcesRead.push(file);
    for (const route of extractRoutePaths(source)) {
      if (!routePaths.includes(route)) routePaths.push(route);
      if (routePaths.length >= MAX_ROUTE_PATHS) break;
    }
  }

  return Object.freeze({
    version: SYSTEM_MANIFEST_VERSION,
    generated_from_deployed_source: true,
    workspaces: WORKSPACE_SUMMARY,
    registered_ai_tool_keys: Object.freeze(toolKeys.sort()),
    known_application_routes: Object.freeze(routePaths.sort()),
    sources_read: Object.freeze(sourcesRead),
    privacy: Object.freeze({
      live_records_included: false,
      credentials_included: false,
      database_rows_included: false,
      source_code_body_included: false,
    }),
  });
}

function getSystemKnowledgeManifest({ force = false } = {}) {
  if (!force && cachedManifest) return cachedManifest;
  cachedManifest = buildSystemKnowledgeManifest();
  return cachedManifest;
}

function renderSystemKnowledgeManifest(manifest = getSystemKnowledgeManifest()) {
  const safe = manifest || {};
  const tools = Array.isArray(safe.registered_ai_tool_keys)
    ? safe.registered_ai_tool_keys.slice(0, MAX_TOOL_KEYS)
    : [];
  const routes = Array.isArray(safe.known_application_routes)
    ? safe.known_application_routes.slice(0, MAX_ROUTE_PATHS)
    : [];
  return [
    `CHALIN system manifest ${safe.version || SYSTEM_MANIFEST_VERSION}:`,
    `Workspaces: ${(safe.workspaces || WORKSPACE_SUMMARY).join(", ")}.`,
    `Registered governed AI capabilities: ${tools.length ? tools.join(", ") : "none discovered"}.`,
    `Known application route surfaces: ${routes.length ? routes.join(", ") : "none discovered"}.`,
    "This manifest describes deployed product surfaces only. It contains no live company records, credentials, customer rows, worker rows or secret values.",
  ].join("\n");
}

function clearSystemKnowledgeManifestCache() {
  cachedManifest = null;
}

module.exports = {
  MAX_ROUTE_PATHS,
  MAX_TOOL_KEYS,
  ROUTE_SOURCE_FILES,
  SYSTEM_MANIFEST_VERSION,
  TOOL_SOURCE_FILES,
  WORKSPACE_SUMMARY,
  buildSystemKnowledgeManifest,
  clearSystemKnowledgeManifestCache,
  extractRoutePaths,
  extractToolKeys,
  getSystemKnowledgeManifest,
  readText,
  renderSystemKnowledgeManifest,
  repositoryRoot,
};
