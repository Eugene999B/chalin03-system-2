import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const login = read("src/pages/LoginPage.jsx");
if (!login.includes("../styles/chalin03LoginBespoke.css")) throw new Error("Chalin 03 bespoke login stylesheet is not loaded by the active login wrapper.");

const groupLogin = read("src/styles/groupOperationsLogin.css");
if (!groupLogin.includes("group-operations-map__node > span")) throw new Error("Group login map icon styling is missing.");
if (!groupLogin.includes("font-size: 22px") && !groupLogin.includes("font-size:22px")) throw new Error("Group login map is missing the restored emoji-sized icon treatment.");
if (groupLogin.includes('content: "P"') || groupLogin.includes('content: "M"') || groupLogin.includes('content: "H"')) throw new Error("Group login map still contains letter-only icon substitutions.");

const sidebar = read("src/components/CompactSidebarNavigation.jsx");
if (!sidebar.includes('{icon}</span>')) throw new Error("Sidebar navigation is not rendering the original emoji icon data.");
if (sidebar.includes("charAt(0).toUpperCase()")) throw new Error("Sidebar navigation still derives first-letter markers instead of using its original icons.");

const app = read("src/App.jsx");
if (!app.includes('import SparePartsUsersSettingsWithDebtRemindersPage from "./pages/SparePartsUsersSettingsWithDebtRemindersPage";')) throw new Error("Users & Settings route does not explicitly import the restored wrapper.");
if (!app.includes('<SparePartsUsersSettingsWithDebtRemindersPage />')) throw new Error("Users & Settings route is not explicitly wired to the restored wrapper.");

const wrapper = read("src/pages/SparePartsUsersSettingsWithDebtRemindersPage.jsx");
if (!wrapper.includes("CustomerFeatureControlsPanel")) throw new Error("Customer feature controls are no longer mounted in Users & Settings.");
if (!wrapper.includes("ExecutiveBusinessIntelligenceSettingsPanel")) throw new Error("Executive intelligence controls are no longer mounted in Users & Settings.");

const customer = read("src/components/CustomerFeatureControlsPanel.jsx");
for (const token of ["role=\"dialog\"", "Customer Data Guardrails", "Open settings", "role=\"switch\"", "customer_merge_enabled"]) {
  if (!customer.includes(token)) throw new Error(`Customer settings dialog is missing ${token}.`);
}
if (!customer.includes("setOpen(false)")) throw new Error("Customer settings dialog has no close behavior.");

const executive = read("src/components/ExecutiveBusinessIntelligenceSettingsPanel.jsx");
for (const ruleCode of ["group.executive.weekly_business_intelligence", "group.executive.monthly_business_intelligence"]) {
  if (!executive.includes(ruleCode)) throw new Error(`Executive settings are missing ${ruleCode}.`);
}
for (const token of ["role=\"dialog\"", "Open Intelligence Centre", "role=\"switch\""]) {
  if (!executive.includes(token)) throw new Error(`Executive settings dialog is missing ${token}.`);
}

const vite = read("vite.config.js");
if (vite.includes("restoreSparePartsSmsIntelligence")) throw new Error("Users & Settings still depends on the importer-specific Vite substitution.");

const theme = read("src/utils/chalinTheme.js");
const entry = read("src/main.jsx");
const index = read("index.html");
for (const token of ["localStorage.setItem(STORAGE_KEY", "prefers-color-scheme: dark", "chalin03-theme-change"]) {
  if (!theme.includes(token)) throw new Error("Theme controller is missing " + token);
}
for (const file of ["systemTheme.css", "themeHardening.css", "chalinDarkModeV4.css", "chalinDarkModeV4Compat.css"]) {
  if (!entry.includes(file)) throw new Error("Theme stylesheet is not mounted: " + file);
}
if (index.includes('src="/darkMode.js"')) throw new Error("The retired theme controller must not conflict with the current theme.");
console.log("Feature-integrity regression contracts passed.");
