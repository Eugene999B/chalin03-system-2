const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(backendRoot, "..");

function read(relativePath) {
  return fs.readFileSync(path.resolve(projectRoot, relativePath), "utf8");
}

test("approval centre uses the already reviewed Railway preload gate", () => {
  const packageJson = JSON.parse(read("backend/package.json"));
  const exportBootstrap = read(
    "backend/services/exportWorkbookSafetyBootstrap.js"
  );
  const approvalBootstrap = read(
    "backend/services/operationalApprovalBootstrap.js"
  );

  assert.match(
    packageJson.scripts.start,
    /node -r \.\/services\/exportWorkbookSafetyBootstrap\.js server\.js$/
  );
  assert.doesNotMatch(
    packageJson.scripts.start,
    /runOperationalApprovalCentreStartup|operationalApprovalBootstrap/
  );
  assert.match(exportBootstrap, /require\("\.\/operationalApprovalBootstrap"\)/);
  assert.match(approvalBootstrap, /testDatabaseConnection/);
  assert.match(approvalBootstrap, /runOperationalApprovalCentreStartup/);
  assert.match(approvalBootstrap, /saleRoutes/);
  assert.match(approvalBootstrap, /returnRoutes/);
  assert.match(approvalBootstrap, /auditUnlockRequestRoutes/);
  assert.match(approvalBootstrap, /operationalApprovalExecutionMiddleware/);
});

test("stored requests are tamper checked and cannot contain administrator passwords", () => {
  const service = read("backend/services/operationalApprovalService.js");
  const middleware = read(
    "backend/middleware/operationalApprovalExecutionMiddleware.js"
  );

  assert.match(service, /stableStringify/);
  assert.match(service, /approval_payload_hash/);
  assert.match(middleware, /hashPayload\(request\.approval_payload\)/);
  assert.match(middleware, /timingSafeEqual/);
  assert.doesNotMatch(
    service,
    /approval_payload_json[\s\S]{0,400}approver_password/i
  );
});

test("administrator may self-approve only return refunds and password verification remains mandatory", () => {
  const service = read("backend/services/operationalApprovalService.js");

  assert.match(service, /getRole\(req\) !== "admin"/);
  assert.match(service, /const selfApproval =[\s\S]*request\.requested_by[\s\S]*getUserId\(req\)/);
  assert.match(service, /const adminReturnSelfApproval =[\s\S]*getRole\(req\) === "admin"[\s\S]*request\.approval_kind === "return_refund"/);
  assert.match(service, /if \(selfApproval && !adminReturnSelfApproval\)/);
  assert.match(service, /SELF_APPROVAL_FORBIDDEN/);
  assert.match(service, /bcrypt\.compare/);
  assert.match(service, /userCanAccessBranch/);
  assert.match(service, /administrator self-approved return\/refund/);
});

test("approved actions reuse the established sale and return transaction routes", () => {
  const middleware = read(
    "backend/middleware/operationalApprovalExecutionMiddleware.js"
  );
  const routes = read("backend/routes/operationalApprovalRoutes.js");
  const service = read("backend/services/operationalApprovalService.js");

  assert.match(service, /\/api\/returns/);
  assert.match(service, /\/api\/sales\/\$\{entityId\}/);
  assert.match(routes, /x-chalin-approval-execution/);
  assert.match(middleware, /req\.body =/);
  assert.match(middleware, /approver_username/);
  assert.match(middleware, /approver_password/);
  assert.match(service, /execution_status = 'executing'/);
  assert.match(routes, /finishOperationalExecution/);
});

test("returns send refunds to admins without requesting admin credentials on the manager device", () => {
  const returnsPage = read("frontend/src/pages/ReturnsPage.jsx");
  const batchPanel = read("frontend/src/components/MultiItemReturnPanel.jsx");

  assert.match(
    returnsPage,
    /audit-unlock-requests\/operational\/return-refund/
  );
  assert.match(
    batchPanel,
    /audit-unlock-requests\/operational\/return-refund/
  );
  assert.doesNotMatch(returnsPage, /approver_username|approver_password/);
  assert.doesNotMatch(batchPanel, /approver_username|approver_password/);
});

test("the floating centre supports sale edit, sale void, approve and reject", () => {
  const launcher = read(
    "frontend/src/components/OperationalApprovalLauncher.jsx"
  );
  const main = read("frontend/src/main.jsx");
  const operationalRoot = read("frontend/src/OperationalAppRoot.jsx");
  const publicRoot = read("frontend/src/chalin-one/PublicChalinOneEntry.jsx");

  assert.match(launcher, /operational\/sale-edit/);
  assert.match(launcher, /operational\/sale-void/);
  assert.match(launcher, /Approve and Execute Now/);
  assert.match(launcher, /Reject Without Changes/);
  assert.match(launcher, /Your administrator password/);
  assert.match(operationalRoot, /OperationalApprovalLauncher/);
  assert.match(operationalRoot, /<OperationalApprovalLauncher \/>/);
  assert.doesNotMatch(main, /OperationalApprovalLauncher/);
  assert.doesNotMatch(publicRoot, /OperationalApprovalLauncher/);
  assert.match(main, /import\("\.\/OperationalAppRoot\.jsx"\)/);
  assert.match(main, /import\.meta\.env\.VITE_CHALIN03_BUILD_ID/);
  assert.match(main, /browser-cache-integrity-v36/);
  assert.match(main, /installNoAutomaticRefreshPolicy/);
  assert.doesNotMatch(main, /serviceWorker\.register\(|controllerchange|window\.location\.reload\(/);
});