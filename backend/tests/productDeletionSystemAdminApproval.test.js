const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
function read(...parts) {
  return fs.readFileSync(path.join(ROOT, ...parts), "utf8");
}

const approvalRoutes = read(
  "backend",
  "routes",
  "productDeletionApprovalRoutes.js"
);
const deleteGuard = read(
  "backend",
  "middleware",
  "productDeletionGuardMiddleware.js"
);
const approvalBootstrap = read(
  "backend",
  "services",
  "operationalApprovalBootstrap.js"
);
const productRoutes = read("backend", "routes", "productRoutes.js");
const systemAdminIdentity = read(
  "backend",
  "security",
  "systemAdminIdentity.js"
);
const launcher = read(
  "frontend",
  "src",
  "components",
  "ProductDeletionRequestLauncher.jsx"
);
const main = read("frontend", "src", "main.jsx");

test("product deletion remains a soft archive and never physically deletes the product row", () => {
  assert.match(productRoutes, /SET is_active = FALSE/);
  assert.doesNotMatch(productRoutes, /DELETE\s+FROM\s+products/i);
  assert.match(approvalRoutes, /SET is_active = FALSE/);
  assert.doesNotMatch(approvalRoutes, /DELETE\s+FROM\s+products/i);
});

test("direct product deletion is wrapped by an owner-level security guard", () => {
  assert.match(
    approvalBootstrap,
    /replaceCachedRouter\("\.\.\/routes\/productRoutes"/
  );
  assert.match(approvalBootstrap, /productDeletionGuardMiddleware/);
  assert.match(deleteGuard, /isOriginalSystemAdministrator\(req\.user\)/);
  assert.match(
    deleteGuard,
    /PRODUCT_DELETE_REQUIRES_SYSTEM_ADMIN_APPROVAL/
  );
  assert.match(deleteGuard, /BLOCK_UNAPPROVED_PRODUCT_DELETE_ATTEMPT/);
  assert.match(deleteGuard, /sendOwnerSmsAlert/);
});

test("ordinary administrators and managers submit requests instead of deleting products", () => {
  assert.match(
    approvalRoutes,
    /"\/operational\/product-delete\/:productId"/
  );
  assert.match(approvalRoutes, /requireRole\("admin", "manager"\)/);
  assert.match(approvalRoutes, /SYSTEM_ADMIN_CAN_DELETE_DIRECTLY/);
  assert.match(approvalRoutes, /PRODUCT_DELETE_REQUEST_ALREADY_PENDING/);
  assert.match(approvalRoutes, /REQUEST_EXPIRY_HOURS = 24/);
  assert.match(approvalRoutes, /approval_kind[\s\S]*product_delete|PRODUCT_DELETE_KIND/);
});

test("only the original System Administrator can approve or reject product deletion", () => {
  assert.match(
    approvalRoutes,
    /verifyOriginalSystemAdminPassword/
  );
  assert.match(
    approvalRoutes,
    /if \(!isOriginalSystemAdministrator\(req\.user\)\)/
  );
  assert.match(
    approvalRoutes,
    /PRODUCT_DELETE_SYSTEM_ADMIN_ONLY/
  );
  assert.match(approvalRoutes, /bcrypt\.compare/);
  assert.match(approvalRoutes, /SYSTEM_ADMIN_PASSWORD_INVALID/);
  assert.match(systemAdminIdentity, /SYSTEM_ADMIN_USER_ID/);
  assert.match(systemAdminIdentity, /SYSTEM_ADMIN_USERNAME/);
});

test("approved deletion is bound to the exact product snapshot and request integrity", () => {
  assert.match(approvalRoutes, /product_snapshot/);
  assert.match(approvalRoutes, /approval_payload_hash/);
  assert.match(approvalRoutes, /hashPayload\(payload\)/);
  assert.match(approvalRoutes, /sameSnapshot/);
  assert.match(
    approvalRoutes,
    /PRODUCT_CHANGED_SINCE_DELETE_REQUEST/
  );
  assert.match(
    approvalRoutes,
    /BLOCK_PRODUCT_DELETE_CHANGED_SINCE_REQUEST/
  );
});

test("product deletion request and outcome both generate boss alerts and permanent audit evidence", () => {
  assert.match(approvalRoutes, /sendDeletionRequestAlert/);
  assert.match(approvalRoutes, /sendDeletionOutcomeAlert/);
  assert.match(approvalRoutes, /sendOwnerSmsAlert/);
  assert.match(approvalRoutes, /CREATE_PRODUCT_DELETE_APPROVAL_REQUEST/);
  assert.match(approvalRoutes, /APPROVE_PRODUCT_DELETE_REQUEST/);
  assert.match(approvalRoutes, /REJECT_PRODUCT_DELETE_REQUEST/);
  assert.match(approvalRoutes, /action: "DELETE_PRODUCT"/);
  assert.match(approvalRoutes, /severity: "critical"/);
});

test("product deletion handlers are mounted before generic operational approvals", () => {
  const productIndex = approvalBootstrap.indexOf(
    "wrapper.use(productDeletionApprovalRoutes)"
  );
  const genericIndex = approvalBootstrap.indexOf(
    "wrapper.use(operationalApprovalRoutes)"
  );

  assert.ok(productIndex >= 0, "product deletion approval router must be mounted");
  assert.ok(genericIndex >= 0, "generic operational approval router must remain mounted");
  assert.ok(
    productIndex < genericIndex,
    "product deletion System-Administrator-only handlers must run before generic admin approval handlers"
  );
});

test("non-System-Administrator product UI replaces direct Delete with a secure request flow", () => {
  assert.match(launcher, /is_original_system_administrator/);
  assert.match(launcher, /Request Product Deletion/);
  assert.match(launcher, /System Admin approval required/);
  assert.match(
    launcher,
    /\/audit-unlock-requests\/operational\/product-delete\//
  );
  assert.match(launcher, /hideLegacyDirectDeleteButtons/);
  assert.match(launcher, /boss will receive a security alert immediately/);
  assert.match(main, /ProductDeletionRequestLauncher/);
});
