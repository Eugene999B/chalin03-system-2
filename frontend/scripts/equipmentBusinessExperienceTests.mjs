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
const landing = read("src/pages/EquipmentBusinessLandingPage.jsx");
const gateway = read("src/pages/EquipmentDivisionGatewayPage.jsx");
const manager = read("src/components/EquipmentDivisionStaffManager.jsx");
const managerCss = read("src/styles/equipmentDivisionStaffManager.css");
const experienceCss = read("src/styles/equipmentBusinessExperience.css");

assert(
  portal.includes("<EquipmentBusinessLandingPage />"),
  "The public Equipment route must use the dedicated Equipment Business landing page."
);
assert(
  landing.includes('to="/login"') &&
    landing.includes("to={loginRoute}") &&
    landing.includes("Back to Main Login"),
  "The public Equipment opening must provide obvious Equipment and main login actions."
);
assert(
  landing.includes("Equipment Hire Operations") &&
    landing.includes("Equipment Installment Finance"),
  "The public opening must present both independent divisions."
);
assert(
  gateway.includes("await logout()") &&
    gateway.includes('navigate("/login?workspace=equipment_hire"'),
  "The protected gateway must close the session before returning to login."
);
assert(
  gateway.includes("Back to Login") &&
    gateway.includes("Back to Equipment Login"),
  "The protected gateway must expose persistent login navigation."
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
  "The new Equipment experience must include compact mobile navigation."
);

console.log("Equipment Business experience contracts passed.");
