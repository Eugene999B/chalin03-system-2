import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, "..");
const repoRoot = path.resolve(frontendRoot, "..");

function read(relativePath, root = frontendRoot) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const publicEntry = read("src/chalin-one/PublicChalinOneEntry.jsx");
const guideRuntime = read("src/chalin-one/public-site/PublicGuideRuntime.jsx");
const guideApi = read("src/chalin-one/public-site/publicGuideApi.js");
const guideWidget = read("src/chalin-one/public-site/PublicGuideWidget.jsx");
const guideCss = read("src/chalin-one/public-site/publicGuide.css");
const protectedEntry = read("src/chalin-one/ProtectedChalinOneEntry.jsx");
const providerControl = read("src/chalin-one/ai/AiProviderControlLauncher.jsx");
const providerControlOverhaulCss = read("src/chalin-one/ai/providerControlOverhaul.css");
const aiApi = read("src/chalin-one/ai/aiApi.js");
const systemRoutes = read("backend/routes/systemRoutes.js", repoRoot);
const aiRoutes = read("backend/routes/aiRoutes.js", repoRoot);
const providerPolicy = read("backend/services/aiProviderPolicyService.js", repoRoot);
const providerRegistry = read("backend/ai-providers/registerAiProviders.js", repoRoot);

assert.match(publicEntry, /lazy\(\(\)\s*=>\s*import\("\.\/public-site\/PublicGuideRuntime"\)/);
assert.match(publicEntry, /DeferredPublicGuideRuntime/);
assert.match(publicEntry, /<DeferredPublicGuideRuntime\s*\/>/);
assert.match(publicEntry, /requestIdleCallback/);
assert.match(guideRuntime, /getPublicGuideAvailability/);
assert.match(guideRuntime, /return enabled \? <PublicGuideWidget \/> : null/);
assert.match(guideRuntime, /visibilitychange/);

assert.doesNotMatch(guideApi, /from\s+["']axios["']|axios\.create|axiosClient/);
assert.doesNotMatch(guideApi, /localStorage|sessionStorage|Authorization|Bearer/);
assert.match(guideApi, /publicWebsiteClient/);
assert.match(guideApi, /getPublicGuideAvailability/);
assert.match(guideApi, /\/public\/guide\/sessions/);
assert.match(guideApi, /x-chalin-guide-session/);

assert.match(guideWidget, /Ask Chalin Guide/);
assert.match(guideWidget, /Published public information only/);
assert.match(guideWidget, /cannot access private accounts/i);
assert.match(guideWidget, /Send a secure enquiry/);
assert.match(guideCss, /bottom:\s*92px/);

assert.match(systemRoutes, /require\("\.\/publicGuideRoutes"\)/);
assert.match(systemRoutes, /"\/public\/guide"/);
assert.match(systemRoutes, /requireFeature\("chalinGuide"\)/);

assert.match(protectedEntry, /AiProviderControlLauncher/);
assert.match(protectedEntry, /pathname === "\/intelligence"/);
assert.match(aiApi, /getAiProviderControl/);
assert.match(aiApi, /updateAiProviderControl/);
assert.match(aiApi, /full_context_access:\s*fullContextAccess === true/);
assert.match(aiApi, /\/ai\/provider-control/);
assert.match(providerControl, /CHALIN AI Provider Control/);
assert.match(providerControl, /Public Chalin Guide/);
assert.match(providerControl, /Staff Copilot/);
assert.match(providerControl, /Chalin Executive/);
assert.match(providerControl, /Full Gemini Intelligence/);
assert.match(providerControl, /API keys never enter this page/);
assert.match(providerControl, /Full private\/confidential context is account-bound/);
assert.match(providerControl, /waiting for paid\/private Gemini tier/);
assert.match(providerControl, /CHALIN Local/);
assert.match(providerControlOverhaulCss, /\.aipc-full-context/);

assert.match(aiRoutes, /requireOriginalAdministrator/);
assert.match(aiRoutes, /isOriginalSystemAdministrator/);
assert.match(aiRoutes, /updateProviderProfile/);
assert.match(aiRoutes, /fullContextAccess: req\.body\.full_context_access === true/);
assert.match(providerPolicy, /ai_provider_profiles/);
assert.match(providerPolicy, /AI_GEMINI_FREE_PRIVATE_DATA_LOCAL_FALLBACK/);
assert.match(providerPolicy, /AI_GEMINI_SYSTEM_ADMIN_FULL_CONTEXT/);
assert.match(providerPolicy, /full_context_safety_identifier/);
assert.match(providerPolicy, /GEMINI_SERVICE_TIER/);
assert.match(providerPolicy, /strictPersona/);
assert.doesNotMatch(providerPolicy, /configuration:\s*row\.configuration_json/);
assert.match(providerRegistry, /register\("local"/);
assert.match(providerRegistry, /register\("gemini"/);
assert.match(providerRegistry, /register\("openai"/);

for (const source of [
  guideRuntime,
  guideApi,
  guideWidget,
  providerControl,
  aiApi,
  publicEntry,
  protectedEntry,
]) {
  assert.doesNotMatch(
    source,
    /(?:process\.env|import\.meta\.env)\.(?:OPENAI_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY)/i
  );
  assert.doesNotMatch(
    source,
    /api\.openai\.com|generativelanguage\.googleapis\.com|Authorization\s*:|Bearer\s+/i
  );
}

console.log("CHALIN ONE AI multi-provider + public Guide + full-context source contract passed.");
