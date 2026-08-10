import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PUBLIC_PERFORMANCE_BASELINE,
  PUBLIC_PERFORMANCE_BUDGETS,
  performanceReductionPercent,
} from "../src/chalin-one/publicPerformanceBudgetModel.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, "..");
const distRoot = path.join(frontendRoot, "dist");
const manifestPath = path.join(distRoot, ".vite", "manifest.json");

assert.ok(fs.existsSync(manifestPath), "Vite build manifest is required for CHALIN ONE performance verification.");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const entries = Object.entries(manifest);

function findKey(sourceSuffix) {
  const found = entries.find(([key, item]) =>
    key.endsWith(sourceSuffix) || String(item?.src || "").endsWith(sourceSuffix)
  );
  assert.ok(found, `Build manifest is missing ${sourceSuffix}.`);
  return found[0];
}

function findHtmlEntryKey() {
  const found = entries.find(([key, item]) =>
    item?.isEntry === true &&
    (key === "index.html" || String(item?.src || "") === "index.html")
  ) || entries.find(([, item]) => item?.isEntry === true);
  assert.ok(found, "Build manifest is missing the Vite HTML application entry.");
  return found[0];
}

function fileSize(relativePath) {
  const absolutePath = path.join(distRoot, relativePath);
  assert.ok(fs.existsSync(absolutePath), `Built asset is missing: ${relativePath}`);
  return fs.statSync(absolutePath).size;
}

function collectStaticGraph(rootKey) {
  const visited = new Set();
  const assetFiles = new Set();
  const sourceKeys = new Set();

  function visit(key) {
    if (!key || visited.has(key)) return;
    visited.add(key);
    sourceKeys.add(key);
    const item = manifest[key];
    assert.ok(item, `Manifest dependency is missing: ${key}`);
    if (item.file) assetFiles.add(item.file);
    for (const css of item.css || []) assetFiles.add(css);
    for (const importedKey of item.imports || []) visit(importedKey);
  }

  visit(rootKey);
  return { assetFiles, sourceKeys };
}

function measureFiles(files) {
  let js = 0;
  let css = 0;
  const details = [];
  for (const file of files) {
    const bytes = fileSize(file);
    details.push({ file, bytes });
    if (file.endsWith(".js")) js += bytes;
    if (file.endsWith(".css")) css += bytes;
  }
  return { js, css, details };
}

function unionSets(...sets) {
  return new Set(sets.flatMap((set) => Array.from(set)));
}

// Vite represents the browser entry by index.html in the manifest even though
// the module script inside that document is src/main.jsx. Dynamic application
// roots retain source-path manifest keys, so resolve those separately.
const mainKey = findHtmlEntryKey();
const publicEntryKey = findKey("src/chalin-one/PublicChalinOneEntry.jsx");
const publicAppKey = findKey("src/chalin-one/public-site/PublicCorporateWebsiteApp.jsx");
const operationalRootKey = findKey("src/OperationalAppRoot.jsx");
const protectedRootKey = findKey("src/chalin-one/ProtectedChalinOneEntry.jsx");

const mainGraph = collectStaticGraph(mainKey);
const publicEntryGraph = collectStaticGraph(publicEntryKey);
const publicAppGraph = collectStaticGraph(publicAppKey);
const mainMeasure = measureFiles(mainGraph.assetFiles);
const publicEntryMeasure = measureFiles(publicEntryGraph.assetFiles);
const publicAppMeasure = measureFiles(publicAppGraph.assetFiles);
const publicCriticalMeasure = measureFiles(
  unionSets(mainGraph.assetFiles, publicEntryGraph.assetFiles, publicAppGraph.assetFiles)
);

assert.ok(
  !mainGraph.sourceKeys.has(operationalRootKey),
  "OperationalAppRoot must remain outside the initial public entry graph."
);
assert.ok(
  !mainGraph.sourceKeys.has(protectedRootKey),
  "ProtectedChalinOneEntry must remain outside the initial public entry graph."
);

assert.ok(
  mainMeasure.js <= PUBLIC_PERFORMANCE_BUDGETS.entry_js_bytes,
  `Initial entry JS ${mainMeasure.js} exceeds budget ${PUBLIC_PERFORMANCE_BUDGETS.entry_js_bytes}.`
);
assert.ok(
  publicEntryMeasure.js <= PUBLIC_PERFORMANCE_BUDGETS.public_entry_js_bytes,
  `Public entry JS ${publicEntryMeasure.js} exceeds budget ${PUBLIC_PERFORMANCE_BUDGETS.public_entry_js_bytes}.`
);
assert.ok(
  publicAppMeasure.js <= PUBLIC_PERFORMANCE_BUDGETS.public_app_js_bytes,
  `Public corporate app JS ${publicAppMeasure.js} exceeds budget ${PUBLIC_PERFORMANCE_BUDGETS.public_app_js_bytes}.`
);
assert.ok(
  publicAppMeasure.css <= PUBLIC_PERFORMANCE_BUDGETS.public_app_css_bytes,
  `Public corporate app CSS ${publicAppMeasure.css} exceeds budget ${PUBLIC_PERFORMANCE_BUDGETS.public_app_css_bytes}.`
);
assert.ok(
  publicCriticalMeasure.js <= PUBLIC_PERFORMANCE_BUDGETS.public_critical_js_bytes,
  `Public critical-path JS ${publicCriticalMeasure.js} exceeds budget ${PUBLIC_PERFORMANCE_BUDGETS.public_critical_js_bytes}.`
);
assert.ok(
  publicCriticalMeasure.css <= PUBLIC_PERFORMANCE_BUDGETS.public_critical_css_bytes,
  `Public critical-path CSS ${publicCriticalMeasure.css} exceeds budget ${PUBLIC_PERFORMANCE_BUDGETS.public_critical_css_bytes}.`
);

const entryReduction = performanceReductionPercent(
  PUBLIC_PERFORMANCE_BASELINE.previous_entry_js_bytes,
  mainMeasure.js
);
assert.ok(
  entryReduction >= 60,
  `Public boot split must reduce the former shared entry JS by at least 60%; measured ${entryReduction}%.`
);

console.log("CHALIN ONE public performance budget report:");
console.log(JSON.stringify({
  baseline: PUBLIC_PERFORMANCE_BASELINE,
  budgets: PUBLIC_PERFORMANCE_BUDGETS,
  measured: {
    entry_js_bytes: mainMeasure.js,
    public_entry_js_bytes: publicEntryMeasure.js,
    public_app_js_bytes: publicAppMeasure.js,
    public_app_css_bytes: publicAppMeasure.css,
    public_critical_js_bytes: publicCriticalMeasure.js,
    public_critical_css_bytes: publicCriticalMeasure.css,
    former_shared_entry_reduction_percent: entryReduction,
  },
}, null, 2));

if (process.env.KEEP_CHALIN_ONE_BUILD_MANIFEST !== "true") {
  fs.rmSync(manifestPath, { force: true });
  const manifestDirectory = path.dirname(manifestPath);
  if (fs.existsSync(manifestDirectory) && fs.readdirSync(manifestDirectory).length === 0) {
    fs.rmdirSync(manifestDirectory);
  }
}

console.log("✅ CHALIN ONE public critical-path performance budgets passed.");
