import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.cwd());

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function expect(source, pattern, label) {
  if (!pattern.test(source)) {
    throw new Error(`Content Studio AI contract failed: ${label}`);
  }
}

function reject(source, pattern, label) {
  if (pattern.test(source)) {
    throw new Error(`Content Studio AI contract failed: ${label}`);
  }
}

const entry = read("src/chalin-one/ProtectedChalinOneEntry.jsx");
const launcher = read("src/chalin-one/content-studio/ContentStudioAiLauncher.jsx");
const api = read("src/chalin-one/content-studio/contentStudioAiApi.js");
const css = read("src/chalin-one/content-studio/contentStudioAi.css");

expect(entry, /lazy\(\(\) =>\s*import\("\.\/content-studio\/ContentStudioAiLauncher"\)\s*\)/s, "Studio AI must be lazy-loaded");
expect(entry, /pathname\.startsWith\("\/content-studio\/"\)/, "Studio AI must be limited to Content Studio paths");
expect(entry, /<ContentStudioAiLauncher\s*\/>/, "Studio AI launcher must be mounted in the protected CHALIN ONE root");

expect(launcher, /flags\?\.aiEnabled === true && flags\?\.chalinCopilot === true/, "Studio AI must honor server-authoritative AI feature flags");
expect(launcher, /getContentStudioAiStatus/, "Studio AI must verify protected server status");
expect(launcher, /askContentStudioAi\(cleanQuestion/, "Studio AI must send only the bounded user question through its API client");
expect(launcher, /Aggregate Content Studio evidence only/, "Studio AI must disclose its aggregate evidence boundary");
expect(launcher, /cannot approve, publish, edit or archive content/i, "Studio AI must display read-only authority");
expect(launcher, /provider\.effective|providerLabel/, "Studio AI must show effective provider routing");
expect(launcher, /provider\.selected|selectedProviderLabel/, "Studio AI must make provider fallback visible");

expect(api, /\/content-studio\/dashboard\/intelligence/, "Studio AI must use the protected Content Studio endpoint");
expect(api, /\{ question: String\(question \|\| ""\)\.trim\(\)\.slice\(0, 1800\) \}/, "Studio AI request body must contain only a bounded question");
reject(api, /tool_key|tool_calls|evidence\s*:|provider_key|model_key|API_KEY|Authorization\s*:/i, "Studio AI browser client must not send tools, evidence, provider policy or secrets");
reject(api, /generativelanguage\.googleapis\.com|api\.openai\.com/i, "Studio AI browser client must not contact AI providers directly");

expect(css, /@media \(max-width: 640px\)/, "Studio AI must have a mobile layout");
expect(css, /@media \(prefers-reduced-motion: reduce\)/, "Studio AI must respect reduced motion");

console.log("CHALIN ONE Content Studio AI frontend contract passed.");
