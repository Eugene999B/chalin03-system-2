import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const login = read("src/pages/LoginPage.jsx");
if (!login.includes("../styles/chalin03LoginBespoke.css")) {
  throw new Error("Chalin 03 bespoke login stylesheet is not loaded by the active login wrapper.");
}

const groupLogin = read("src/styles/groupOperationsLogin.css");
if (!groupLogin.includes('.group-operations-map__node > span {\n  font-size: 22px;')) {
  throw new Error("Group login map is not using the restored emoji presentation.");
}
if (groupLogin.includes('content: "P"') || groupLogin.includes('content: "M"') || groupLogin.includes('content: "H"')) {
  throw new Error("Group login map still contains letter-only icon substitutions.");
}

const sidebar = read("src/components/CompactSidebarNavigation.jsx");
if (!sidebar.includes('{icon}</span>')) {
  throw new Error("Sidebar navigation is not rendering the original emoji icon data.");
}
if (sidebar.includes("charAt(0).toUpperCase()")) {
  throw new Error("Sidebar navigation still derives first-letter markers instead of using its original icons.");
}

const app = read("src/App.jsx");
if (!app.includes('import SparePartsUsersSettingsWithDebtRemindersPage from "./pages/SparePartsUsersSettingsWithDebtRemindersPage";')) {
  throw new Error("Users & Settings route does not explicitly import the restored wrapper.");
}
if (!app.includes('<SparePartsUsersSettingsWithDebtRemindersPage />')) {
  throw new Error("Users & Settings route is not explicitly wired to the restored wrapper.");
}

const wrapper = read("src/pages/SparePartsUsersSettingsWithDebtRemindersPage.jsx");
if (!wrapper.includes("CustomerFeatureControlsPanel")) {
  throw new Error("Customer feature controls are no longer mounted in Users & Settings.");
}
if (!wrapper.includes("ExecutiveBusinessIntelligenceSettingsPanel")) {
  throw new Error("Executive intelligence controls are no longer mounted in Users & Settings.");
}

const executive = read("src/components/ExecutiveBusinessIntelligenceSettingsPanel.jsx");
for (const ruleCode of [
  "group.executive.weekly_business_intelligence",
  "group.executive.monthly_business_intelligence",
]) {
  if (!executive.includes(ruleCode)) {
    throw new Error(`Executive settings are missing ${ruleCode}.`);
  }
}

const vite = read("vite.config.js");
if (vite.includes("restoreSparePartsSmsIntelligence")) {
  throw new Error("Users & Settings still depends on the importer-specific Vite substitution.");
}

const darkMode = read("src/styles/darkMode.css");
for (const requiredToken of [
  "--c03-dm-bg",
  ".c03-dark-mode input",
  ".c03-dark-mode table",
  ".c03-dark-mode nav",
  ".c03-dark-mode .gate4.biometric-login .gate4__submit",
]) {
  if (!darkMode.includes(requiredToken)) {
    throw new Error(`Global dark mode is missing permanent coverage for ${requiredToken}.`);
  }
}

const darkModeScript = read("public/darkMode.js");
if (!darkModeScript.includes('localStorage.setItem(STORAGE_KEY')) {
  throw new Error("Dark mode preference is not persisted per browser.");
}
if (!darkModeScript.includes("c03-theme-toggle")) {
  throw new Error("Global dark mode toggle is not mounted.");
}

const index = read("index.html");
if (!index.includes('href="/src/styles/darkMode.css"')) {
  throw new Error("Dark mode stylesheet is not mounted before application rendering.");
}
if (!index.includes('src="/darkMode.js"')) {
  throw new Error("Global dark mode controller is not mounted from the application shell.");
}

console.log("Feature-integrity regression contracts passed.");
