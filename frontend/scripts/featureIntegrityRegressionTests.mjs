import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const login = read("src/pages/LoginPage.jsx");
if (!login.includes("../styles/chalin03LoginBespoke.css")) {
  throw new Error("Chalin 03 bespoke login stylesheet is not loaded by the active login wrapper.");
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

console.log("Feature-integrity regression contracts passed.");
