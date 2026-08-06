"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  ContentStudioError,
} = require("../services/contentStudioPageService");
const {
  PUBLIC_SETTING_KEYS,
  SENSITIVE_KEY_FRAGMENTS,
  assertPublicSettingAllowed,
  normalizeSettingGroup,
  normalizeSettingKey,
} = require("../services/contentStudioSettingsService");

const repoRoot = path.resolve(__dirname, "../..");
const serviceSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/contentStudioSettingsService.js"),
  "utf8"
);
const sharedAuditSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/contentStudioPageService.js"),
  "utf8"
);
const settingsRouteSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/contentStudioSettingsRoutes.js"),
  "utf8"
);
const mainRouteSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/contentStudioRoutes.js"),
  "utf8"
);

test("website setting keys and groups use a controlled format", () => {
  assert.equal(normalizeSettingKey("Site.Contact"), "site.contact");
  assert.equal(normalizeSettingKey("site social links"), null);
  assert.equal(normalizeSettingKey("../../jwt_secret"), null);
  assert.equal(normalizeSettingGroup("Brand Settings"), "general");
  assert.equal(normalizeSettingGroup("brand.settings"), "brand.settings");
});

test("only approved non-sensitive keys may become anonymous public settings", () => {
  for (const settingKey of PUBLIC_SETTING_KEYS) {
    assert.doesNotThrow(() => assertPublicSettingAllowed(settingKey, true));
  }

  assert.throws(
    () => assertPublicSettingAllowed("site.custom_unknown", true),
    (error) =>
      error instanceof ContentStudioError &&
      error.code === "PUBLIC_SETTING_KEY_NOT_ALLOWLISTED"
  );

  for (const fragment of SENSITIVE_KEY_FRAGMENTS) {
    assert.throws(
      () => assertPublicSettingAllowed(`site.${fragment}`, true),
      (error) =>
        error instanceof ContentStudioError &&
        error.code === "PUBLIC_SETTING_SENSITIVE_KEY_BLOCKED"
    );
  }
});

test("private inactive or internal settings can exist without becoming public", () => {
  assert.doesNotThrow(() => assertPublicSettingAllowed("internal.cms_notes", false));
  assert.doesNotThrow(() => assertPublicSettingAllowed("internal.api_key_reference", false));
});

test("settings writes are transactional, audited and never delete records", () => {
  assert.match(serviceSource, /beginTransaction\(\)/);
  assert.match(serviceSource, /commit\(\)/);
  assert.match(serviceSource, /rollback\(\)/);
  assert.match(serviceSource, /insertContentAudit\(connection/);
  assert.match(sharedAuditSource, /INSERT INTO public_content_audit_log/);
  assert.match(serviceSource, /PUBLIC_SITE_SETTING_CREATED/);
  assert.match(serviceSource, /PUBLIC_SITE_SETTING_UPDATED/);
  assert.match(serviceSource, /PUBLIC_SITE_SETTING_DEACTIVATED/);
  assert.doesNotMatch(serviceSource, /DELETE FROM public_site_settings/i);
});

test("website settings routes separate reading from administrator-only management", () => {
  assert.match(settingsRouteSource, /public_settings\.view/);
  assert.match(settingsRouteSource, /public_settings\.manage/);
  assert.match(settingsRouteSource, /Cache-Control.*no-store/s);
  assert.match(mainRouteSource, /router\.use\("\/settings", contentStudioSettingsRoutes\)/);
});
