import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const login = read("src/pages/LoginPage.jsx");
if (!login.includes("../styles/chalin03LoginBespoke.css")) {
  throw new Error("Chalin 03 bespoke login stylesheet is not loaded by the active login wrapper.");
}

const groupLogin = read("src/styles/groupOperationsLogin.css");
if (!groupLogin.includes('.group-operations-map__node.is-parts > span::after')) {
  throw new Error("Group login map has regressed to legacy emoji presentation.");
}

const sidebar = read("src/components/CompactSidebarNavigation.jsx");
if (sidebar.includes('{item.icon}</span>')) {
  throw new Error("Sidebar navigation has regressed to rendering emoji icon data directly.");
}
if (!sidebar.includes("charAt(0).toUpperCase()")) {
  throw new Error("Sidebar navigation no longer provides the clean text marker design.");
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
if (!vite.includes('if (source === "./pages/UsersSettingsPage")')) {
  throw new Error("Users & Settings restoration still depends on an importer-specific Vite substitution.");
}

console.log("Feature-integrity regression contracts passed.");
