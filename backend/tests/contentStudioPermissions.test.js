"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  ALL_PERMISSIONS,
  CONTENT_STUDIO_PERMISSIONS,
  getEffectivePermissions,
  permissionsForWorkspace,
} = require("../security/permissionCatalog");
const {
  CONTENT_STUDIO_PROTECTED_GRANTS,
  isContentStudioPermission,
} = require("../security/contentStudioPermissionCatalog");
const {
  ADMIN_ONLY_GRANTS,
  applyPermissionOverrides,
  buildPermissionDescriptors,
  validateOverridePolicy,
} = require("../services/permissionOverrideService");

const repoRoot = path.resolve(__dirname, "../..");
const studioMigration = fs.readFileSync(
  path.join(repoRoot, "database/migrations/20260808_chalin_one_content_studio_identity.sql"),
  "utf8"
);

const WORKSPACES = ["spare_parts", "mining", "equipment_hire"];

test("every Content Studio capability remains registered centrally", () => {
  assert.equal(CONTENT_STUDIO_PERMISSIONS.length, 20);

  for (const permission of CONTENT_STUDIO_PERMISSIONS) {
    assert.equal(ALL_PERMISSIONS.includes(permission), true, permission);
    assert.equal(isContentStudioPermission(permission), true, permission);

    // The legacy catalog still knows the capability names so existing route
    // middleware remains stable, but Phase 2A no longer exposes these through
    // the operational permission manager or operational override resolution.
    for (const workspace of WORKSPACES) {
      assert.equal(
        permissionsForWorkspace(workspace).includes(permission),
        true,
        `${permission} missing from central catalog for ${workspace}`
      );
    }
  }
});

test("legacy role catalog remains backward compatible while ordinary staff have no Studio defaults", () => {
  const adminPermissions = getEffectivePermissions({
    id: 9,
    username: "category-admin",
    role: "admin",
    workspace_code: "mining",
    workspace_role: "manager",
  });
  const managerPermissions = getEffectivePermissions({
    id: 10,
    username: "manager",
    role: "manager",
    workspace_code: "spare_parts",
  });
  const staffPermissions = getEffectivePermissions({
    id: 11,
    username: "staff",
    role: "staff",
    workspace_code: "mining",
    workspace_role: "site_clerk",
  });

  for (const permission of CONTENT_STUDIO_PERMISSIONS) {
    assert.equal(adminPermissions.includes(permission), true, permission);
  }

  assert.equal(managerPermissions.includes("public_content.view"), false);
  assert.equal(managerPermissions.includes("public_content.publish"), false);
  assert.equal(staffPermissions.includes("public_media.manage"), false);
});

test("low-level override reducer still handles generic allow and deny records deterministically", () => {
  const base = ["workspace.view"];
  const granted = applyPermissionOverrides(base, [
    {
      permission_code: "public_content.view",
      effect: "allow",
    },
    {
      permission_code: "public_content.edit",
      effect: "allow",
    },
  ]);

  assert.equal(granted.includes("public_content.view"), true);
  assert.equal(granted.includes("public_content.edit"), true);

  const denied = applyPermissionOverrides(granted, [
    {
      permission_code: "public_content.edit",
      effect: "deny",
    },
  ]);
  assert.equal(denied.includes("public_content.view"), true);
  assert.equal(denied.includes("public_content.edit"), false);
});

test("operational permission overrides cannot grant Content Studio capabilities", () => {
  for (const targetUser of [
    {
      id: 20,
      username: "communications-officer",
      role: "staff",
    },
    {
      id: 22,
      username: "operational-admin",
      role: "admin",
    },
  ]) {
    const policy = validateOverridePolicy({
      targetUser,
      permissionCode: "public_content.edit",
      effect: "allow",
      workspaceCode: "spare_parts",
    });

    assert.equal(policy.ok, false);
    assert.equal(policy.code, "CONTENT_STUDIO_PERMISSION_DOMAIN_SEPARATE");
  }
});

test("website-wide settings management belongs to the Studio role system", () => {
  assert.deepEqual(CONTENT_STUDIO_PROTECTED_GRANTS, [
    "public_settings.manage",
  ]);
  assert.equal(ADMIN_ONLY_GRANTS.includes("public_settings.manage"), true);

  for (const role of ["staff", "admin"]) {
    const policy = validateOverridePolicy({
      targetUser: {
        id: role === "admin" ? 22 : 21,
        username: `${role}-operator`,
        role,
      },
      permissionCode: "public_settings.manage",
      effect: "allow",
      workspaceCode: "spare_parts",
    });
    assert.equal(policy.ok, false);
    assert.equal(policy.code, "CONTENT_STUDIO_PERMISSION_DOMAIN_SEPARATE");
  }

  assert.match(
    studioMigration,
    /WHERE r\.role_code = 'content_administrator';/
  );
  assert.match(studioMigration, /SELECT 'public_settings\.manage'/);
});

test("operational permission manager excludes Content Studio capabilities", () => {
  const descriptors = buildPermissionDescriptors("spare_parts");
  const codes = new Set(descriptors.map((item) => item.code));

  for (const permission of CONTENT_STUDIO_PERMISSIONS) {
    assert.equal(
      codes.has(permission),
      false,
      `${permission} must be managed through Content Studio roles instead`
    );
  }
  assert.equal(codes.has("workspace.view"), true);
});
