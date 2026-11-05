import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const axiosClient = read("src", "api", "axiosClient.js");
const passwordPage = read("src", "pages", "ChangePasswordPage.jsx");
const authRoutes = read("..", "backend", "routes", "authRoutes.js");
const service = read("..", "backend", "services", "passwordChangeService.js");

const checks = [
  [
    /requestPath === "\/auth\/change-password"[\s\S]*?CURRENT_PASSWORD_INCORRECT/,
    axiosClient,
    "change-password credential failures are classified separately",
  ],
  [
    /!isChangePasswordCredentialFailure/,
    axiosClient,
    "credential mismatch cannot clear the active browser session",
  ],
  [
    /code: "CURRENT_PASSWORD_INCORRECT"/,
    authRoutes,
    "backend returns a stable current-password validation code",
  ],
  [
    /res\.status\(400\)/,
    authRoutes,
    "wrong current password is a validation error rather than authentication expiry",
  ],
  [
    /changePasswordAtomically/,
    authRoutes,
    "route uses the atomic password/session service",
  ],
  [
    /beginTransaction\(\)[\s\S]*?UPDATE users[\s\S]*?UPDATE auth_sessions[\s\S]*?commit\(\)/,
    service,
    "password update and session revocation share one transaction",
  ],
  [
    /requestError\.response\?\.data\?\.message/,
    passwordPage,
    "the password page displays the server validation message",
  ],
];

for (const [pattern, source, description] of checks) {
  if (!pattern.test(source)) {
    console.error(`Password change regression failed: ${description}`);
    process.exit(1);
  }
}

console.log("Password change session regression checks passed.");
