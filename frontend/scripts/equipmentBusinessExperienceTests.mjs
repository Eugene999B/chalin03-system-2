import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const portal = read("src/pages/EquipmentHirePortalPage.jsx");
const gateway = read("src/pages/EquipmentDivisionGatewayPage.jsx");
const workspaces = read("src/data/businessWorkspaces.js");
const manager = read("src/components/EquipmentDivisionStaffManager.jsx");
const managerCss = read("src/styles/equipmentDivisionStaffManager.css");
const experienceCss = read("src/styles/equipmentBusinessExperience.css");

assert(
  portal.includes('Navigate to="/login?workspace=equipment_hire"') &&
    portal.includes("<EquipmentDivisionGatewayPage />"),
  "The Equipment entry must require login before opening the protected division gateway."
);
assert(
  !portal.includes("EquipmentBusinessLandingPage"),
  "The public Equipment marketing landing page must not remain in the staff flow."
);
assert(
  workspaces.includes('route: "/login?workspace=equipment_hire"'),
  "The Equipment workspace card must open its login context directly."
);
assert(
  gateway.includes("await logout()") &&
    gateway.includes('window.location.replace("/login?workspace=equipment_hire")'),
  "The protected gateway must close the session before replacing history with Login."
);
assert(
  gateway.includes("Back to Login") &&
    gateway.includes("Back to Equipment Login"),
  "The protected gateway must expose persistent login navigation."
);
assert(
  !gateway.includes('/company/') && !gateway.includes("Company Overview"),
  "The protected gateway must not send staff into the retired company marketing page."
);
assert(
  manager.includes('import { createPortal } from "react-dom"') &&
    manager.includes("createPortal(manager, document.body)"),
  "The administrator staff manager must render outside the gateway stacking context."
);
assert(
  manager.includes('event.key === "Escape"') &&
    manager.includes('document.body.style.overflow = "hidden"'),
  "The administrator manager must support Escape and prevent background scrolling."
);
assert(
  managerCss.includes("z-index: 99999") &&
    managerCss.includes("isolation: isolate"),
  "The staff manager must remain above every Equipment gateway card."
);
assert(
  experienceCss.includes("@media (max-width: 680px)") &&
    experienceCss.includes(".equipment-command__logout"),
  "The Equipment gateway must retain compact mobile navigation."
);

console.log("Equipment Business protected login-first experience contracts passed.");
