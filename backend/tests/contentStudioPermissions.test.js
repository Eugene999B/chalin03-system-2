"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

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

const WORKSPACES = ["spare_parts", "mining", "equipment_hire"];

test("every Content Studio capability is registered centrally in every workspace", () => {
  assert.equal(CONTENT_STUDIO_PERMISSIONS.length, 20);

  for (const permission of CONTENT_STUDIO_PERMISSIONS) {
    assert.equal(ALL_PERMISSIONS.includes(permission), true, permission);
    assert.equal(isContentStudioPermission(permission), true, permission);

    for (const workspace of WORKSPACES) {
      assert.equal(
        permissionsForWorkspace(workspace).includes(permission),
        true,
        `${permission} missing from ${workspace}`
      );
    }
  }
});

test("administrators receive Content Studio permissions but ordinary staff do not automatically", () => {
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

test("existing permission overrides can deliberately grant and deny Content Studio access", () => {
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

test("editorial permissions may be granted deliberately to non-admin staff", () => {
  const policy = validateOverridePolicy({
    targetUser: {
      id: 20,
      username: "communications-officer",
      role: "staff",
    },
    permissionCode: "public_content.edit",
    effect: "allow",
    workspaceCode: "spare_parts",
  });

  assert.equal(policy.ok, true);
  assert.equal(policy.effect, "allow");
});

test("website-wide settings management remains administrator-only", () => {
  assert.deepEqual(CONTENT_STUDIO_PROTECTED_GRANTS, [
    "public_settings.manage",
  ]);
  assert.equal(ADMIN_ONLY_GRANTS.includes("public_settings.manage"), true);

  const staffPolicy = validateOverridePolicy({
    targetUser: {
      id: 21,
      username: "communications-officer",
      role: "staff",
    },
    permissionCode: "public_settings.manage",
    effect: "allow",
    workspaceCode: "spare_parts",
  });
  assert.equal(staffPolicy.ok, false);
  assert.equal(staffPolicy.code, "ADMIN_PERMISSION_PROTECTED");

  const adminPolicy = validateOverridePolicy({
    targetUser: {
      id: 22,
      username: "content-admin",
      role: "admin",
    },
    permissionCode: "public_settings.manage",
    effect: "allow",
    workspaceCode: "spare_parts",
  });
  assert.equal(adminPolicy.ok, true);
});

test("permission manager groups Content Studio capabilities clearly", () => {
  const descriptors = buildPermissionDescriptors("spare_parts");
  const byCode = new Map(descriptors.map((item) => [item.code, item]));

  assert.equal(
    byCode.get("public_content.publish")?.category,
    "Content Studio — Content"
  );
  assert.equal(
    byCode.get("public_media.manage")?.category,
    "Content Studio — Media"
  );
  assert.equal(
    byCode.get("public_submissions.respond")?.category,
    "Content Studio — Enquiries"
  );
  assert.equal(
    byCode.get("public_settings.manage")?.admin_only_grant,
    true
  );
});
