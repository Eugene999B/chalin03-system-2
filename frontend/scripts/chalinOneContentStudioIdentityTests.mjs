import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(currentFile), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(frontendRoot, relativePath), "utf8");
}

const auth = read("src/context/AuthContext.jsx");
const standalone = read("src/chalin-one/ChalinOneStandaloneEntry.jsx");
const login = read("src/chalin-one/content-studio/ContentStudioLoginPage.jsx");
const password = read("src/chalin-one/content-studio/ContentStudioChangePasswordPage.jsx");
const workspace = read("src/chalin-one/content-studio/ContentStudioWorkspace.jsx");
const access = read("src/chalin-one/content-studio/ContentStudioAccessManager.jsx");
const accessApi = read("src/chalin-one/content-studio/contentStudioAccessApi.js");
const authCss = read("src/chalin-one/content-studio/contentStudioAuth.css");
const accessCss = read("src/chalin-one/content-studio/contentStudioAccessManager.css");

assert.match(auth, /CONTENT_STUDIO_WORKSPACE_CODE = "content_studio"/);
assert.match(auth, /"\/content-studio-auth\/login"/);
assert.match(auth, /"\/content-studio-auth\/me"/);
assert.match(auth, /isContentStudioWorkspace/);
assert.match(auth, /contentStudioRoleName/);
assert.match(auth, /contentStudioScopes/);
assert.match(auth, /isContentStudioOwner/);

assert.match(standalone, /ContentStudioLoginPage/);
assert.match(standalone, /ContentStudioChangePasswordPage/);
assert.match(standalone, /function ContentStudioSessionGate/);
assert.match(standalone, /path="\/content-studio\/login"/);
assert.match(standalone, /path="\/content-studio\/change-password"/);
assert.match(standalone, /!isLoggedIn \|\| !isContentStudioWorkspace/);
assert.match(standalone, /<ContentStudioSessionGate>/);
assert.match(standalone, /permissions=\{\["public_content\.view"\]\}/);
const studioEntryStart = standalone.indexOf("function ContentStudioEntry");
const intelligenceStart = standalone.indexOf("function IntelligenceWorkspaceSurface");
const studioEntrySource = standalone.slice(studioEntryStart, intelligenceStart);
assert.doesNotMatch(studioEntrySource, /<ProtectedRoute>/);
assert.doesNotMatch(studioEntrySource, /<StaffStandaloneShell/);

assert.match(login, /workspaceCode: "content_studio"/);
assert.match(login, /The website has its own control room/);
assert.match(login, /separated from Spare Parts, Mining and Equipment operations/);
assert.match(login, /Studio-only accounts cannot enter operational business workspaces/);
assert.match(login, /href="\/login"/);
assert.match(password, /\/content-studio-auth\/change-password/);
assert.match(password, /logout\(\)/);
assert.match(password, /\/content-studio\/login/);
assert.match(password, /8 characters with uppercase, lowercase, a number and a symbol/);

assert.match(workspace, /SECTION_SCOPES/);
assert.match(workspace, /scopeSet/);
assert.match(workspace, /auth\.isContentStudioOwner/);
assert.match(workspace, /ACCESS_SECTION/);
assert.match(workspace, /key: "access"/);
assert.match(workspace, /ContentStudioAccessManager/);
assert.match(workspace, /!auth\.isContentStudioWorkspace/);
assert.match(workspace, /Studio identity/);
assert.doesNotMatch(workspace, /Staff sign-in required/);

for (const marker of [
  "New publishing identity",
  "Studio-only account",
  "Protected identity",
  "Reset password",
  "Disable",
  "Enable",
]) {
  assert.match(access, new RegExp(marker));
}
assert.match(access, /listContentStudioRoles/);
assert.match(access, /listContentStudioAccounts/);
assert.match(access, /createContentStudioAccount/);
assert.match(access, /updateContentStudioAccount/);
assert.match(access, /resetContentStudioAccountPassword/);
assert.match(access, /account\.protected_owner/);
assert.match(accessApi, /\/content-studio\/access\/roles/);
assert.match(accessApi, /\/content-studio\/access\/accounts/);

assert.match(authCss, /@media \(max-width: 980px\)/);
assert.match(authCss, /@media \(max-width: 560px\)/);
assert.match(authCss, /100dvh/);
assert.match(authCss, /safe-area-inset-bottom/);
assert.match(authCss, /prefers-reduced-motion/);
assert.match(accessCss, /@media \(max-width: 1100px\)/);
assert.match(accessCss, /@media \(max-width: 680px\)/);
assert.match(accessCss, /scroll-snap-type: x mandatory/);
assert.match(accessCss, /safe-area-inset-bottom/);
assert.match(accessCss, /prefers-reduced-motion/);

console.log(
  "✅ CHALIN ONE Phase 2A Content Studio identity contracts passed: isolated Studio login, role scopes, owner-only access management and responsive Studio security UX remain protected."
);
