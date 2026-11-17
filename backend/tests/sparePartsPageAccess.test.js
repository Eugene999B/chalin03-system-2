"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SPARE_PARTS_PAGES, SPARE_PARTS_PAGE_CODES, defaultSparePartsPagePermissions,
} = require("../security/sparePartsPageCatalog");
const {getEffectivePermissions,isPermissionAllowedForWorkspace} = require("../security/permissionCatalog");
const {roleDefaultPermissions,applyPermissionOverrides,validateOverridePolicy} = require("../services/permissionOverrideService");

const auditor = {id:222,username:"store_auditor",role:"auditor",workspace_code:"spare_parts"};
const cashier = {id:223,username:"cashier_person",role:"cashier",workspace_code:"spare_parts"};

test("Every visible Spare Parts page has a unique route and category-scoped code",()=>{
  assert.ok(SPARE_PARTS_PAGES.length>=35);
  assert.equal(new Set(SPARE_PARTS_PAGES.map(p=>p.path)).size,SPARE_PARTS_PAGES.length);
  assert.equal(new Set(SPARE_PARTS_PAGE_CODES).size,SPARE_PARTS_PAGES.length);
  for(const p of SPARE_PARTS_PAGES){
    assert.equal(p.permission,`page.spare_parts.${p.id}.view`);
    assert.equal(isPermissionAllowedForWorkspace(p.permission,"spare_parts"),true);
    assert.equal(isPermissionAllowedForWorkspace(p.permission,"mining"),false);
    assert.equal(isPermissionAllowedForWorkspace(p.permission,"equipment_hire"),false);
  }
});

test("Auditor's real page defaults include operations and audit, not user administration",()=>{
  const defaults=new Set(roleDefaultPermissions(auditor));
  for(const id of ["products","new_sale","debts","sales_history","reports","audit_accounting",
      "stock_count","exports","activity_log","workers","expenses","daily_closing"]){
    assert.equal(defaults.has(`page.spare_parts.${id}.view`),true,id);
  }
  for(const id of ["dashboard","users_settings","user_permissions","sms","backup","maintenance"]){
    assert.equal(defaults.has(`page.spare_parts.${id}.view`),false,id);
  }
  assert.equal(defaults.has("spare_parts.sell"),true);
});

test("Cashier can see sales and debts, not auditor-only reports",()=>{
  const defaults=new Set(roleDefaultPermissions(cashier));
  assert.equal(defaults.has("page.spare_parts.new_sale.view"),true);
  assert.equal(defaults.has("page.spare_parts.reports.view"),false);
  assert.equal(defaults.has("page.spare_parts.user_permissions.view"),false);
});

test("Role-ineligible page grants are rejected and page denies do not change monetary grants",()=>{
  const denied=validateOverridePolicy({targetUser:auditor,
    permissionCode:"page.spare_parts.users_settings.view",effect:"allow",workspaceCode:"spare_parts"});
  assert.equal(denied.ok,false);
  assert.equal(denied.code,"PAGE_ROLE_INELIGIBLE");
  const base=roleDefaultPermissions(auditor);
  const after=applyPermissionOverrides(base,[{
    permission_code:"page.spare_parts.debts.view",effect:"deny"
  }]);
  assert.equal(after.includes("page.spare_parts.debts.view"),false);
  assert.equal(after.includes("spare_parts.sell"),true);
  assert.equal(getEffectivePermissions(auditor).includes("spare_parts.sell"),true);
});

test("Page permission defaults for owner remain protected",()=>{
  const owner={id:1,username:"admin",role:"admin",workspace_code:"spare_parts"};
  const defaults=new Set(roleDefaultPermissions(owner));
  assert.equal(defaults.has("page.spare_parts.user_permissions.view"),true);
  const result=validateOverridePolicy({targetUser:owner,permissionCode:"page.spare_parts.users_settings.view",effect:"deny",workspaceCode:"spare_parts"});
  assert.equal(result.ok,false);
  assert.equal(result.code,"OWNER_PERMISSION_IMMUTABLE");
});
