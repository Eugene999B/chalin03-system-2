const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const backendRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(backendRoot, "..");
const readBackend = (relative) =>
  fs.readFileSync(path.join(backendRoot, relative), "utf8");
const readProject = (relative) =>
  fs.readFileSync(path.join(projectRoot, relative), "utf8");

const dailyRoute = readBackend("routes/dailyClosingRoutes.js");
const executiveRoute = readBackend("routes/groupExecutiveRoutes.js");
const dailyPage = readProject("frontend/src/pages/DailyClosingPage.jsx");
const executivePage = readProject(
  "frontend/src/pages/GroupExecutiveControlPage.jsx"
);
const executiveCss = readProject("frontend/src/styles/groupExecutive.css");

test("boss-approved Daily Closing removes drawer controls without deleting compatibility columns", () => {
  assert.match(
    dailyRoute,
    /Cash Drawer Control was removed from the current business workflow/
  );
  assert.match(dailyRoute, /const cashControls = getCashControls\(\{\}\)/);
  assert.doesNotMatch(dailyPage, /Opening Cash Float/);
  assert.doesNotMatch(dailyPage, /Cash Deposits/);
  assert.doesNotMatch(dailyPage, /Cash Withdrawals/);
  assert.match(dailyPage, /Expected versus counted reconciliation/);
});

test("cash denomination counting is optional on both client and server", () => {
  assert.match(dailyPage, /Use denomination counter/);
  assert.match(dailyPage, /Daily Closing can be saved without/);
  assert.match(dailyPage, /Cash is being entered manually/);
  assert.match(dailyRoute, /hasDenominationEvidence/);
  assert.match(dailyRoute, /Optional cash denomination total GHS/);
  assert.match(dailyRoute, /storedDenominations/);
});

test("Group Executive Control provides professional read-only intelligence", () => {
  assert.match(executivePage, /Executive Intelligence & Control/);
  assert.match(executivePage, /Risk command centre/);
  assert.match(executivePage, /Daily financial trend/);
  assert.match(executivePage, /Daily Closing control status/);
  assert.match(executivePage, /Management action queue/);
  assert.match(executivePage, /no operational editing/i);
  assert.match(executiveCss, /\.gec-hero/);
  assert.match(executiveCss, /\.gec-kpi-grid/);
  assert.match(executiveCss, /\.gec-business-grid/);
});

test("Group Executive API exposes cash-control and trend evidence", () => {
  assert.match(executiveRoute, /cash_control: cashControl/);
  assert.match(executiveRoute, /financial_trend: financialTrend/);
  assert.match(executiveRoute, /changed_after_close_count/);
  assert.match(executiveRoute, /awaiting_verification_count/);
  assert.match(executiveRoute, /Financial Trend/);
  assert.match(executiveRoute, /Cash Control/);
});
