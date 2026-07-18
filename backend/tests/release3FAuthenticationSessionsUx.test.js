const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const {
  normalizeLoginIdentity,
  normalizedPhoneForStorage,
} = require("../services/loginIdentityService");
const {
  friendlySessionEvidence,
  parseDeviceEvidence,
} = require("../services/sessionDeviceService");

test("Release 3F-A accepts username or normalized Ghana phone login", () => {
  assert.deepEqual(normalizeLoginIdentity("Eugene"), {
    identifier: "Eugene",
    method: "username",
    normalizedPhone: null,
  });

  for (const value of ["0241234567", "+233241234567", "233241234567"]) {
    assert.equal(normalizeLoginIdentity(value).method, "phone");
    assert.equal(normalizeLoginIdentity(value).normalizedPhone, "+233241234567");
    assert.equal(normalizedPhoneForStorage(value), "+233241234567");
  }
});

test("Release 3F-A records readable device and precise location evidence", () => {
  const evidence = parseDeviceEvidence({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
    networkCountry: "GH",
    evidence: {
      device_type: "desktop",
      device_label: "Office computer",
      device_platform: "Windows",
      architecture: "x86 64",
      browser_name: "Chrome",
      browser_version: "150.0.0.0",
      screen_width: 1920,
      screen_height: 1080,
      location_permission: "granted",
      latitude: 5.55602,
      longitude: -1.78072,
      location_accuracy_m: 18,
    },
  });

  assert.equal(evidence.device_type, "desktop");
  assert.equal(evidence.location_source, "browser_geolocation");
  assert.equal(evidence.network_country, "GH");

  const friendly = friendlySessionEvidence(evidence);
  assert.match(friendly.device_summary, /Office computer/);
  assert.match(friendly.location_summary, /5\.55602/);
  assert.match(friendly.precise_location.map_url, /openstreetmap\.org/);
});

test("Release 3F-A login route exposes clear lock and attempt evidence", () => {
  const source = read("backend/routes/authRoutes.js");

  assert.match(source, /req\.body\.identifier \|\| req\.body\.username/);
  assert.match(source, /login_phone_normalized/);
  assert.match(source, /Account blocked after three unsuccessful login attempts/);
  assert.match(source, /attempts_remaining/);
  assert.match(source, /device_evidence/);
  assert.match(source, /login_method/);
});

test("Release 3F-A frontend presents phone login, location consent and lock notice", () => {
  const loginPage = read("frontend/src/pages/LoginPage.jsx");
  const authContext = read("frontend/src/context/AuthContext.jsx");
  const collector = read("frontend/src/utils/deviceEvidence.js");

  assert.match(loginPage, /Username or phone number/);
  assert.match(loginPage, /Account blocked/);
  assert.match(loginPage, /Attempts remaining before block/);
  assert.match(loginPage, /Record this login device and precise location/);
  assert.match(loginPage, /collectDeviceEvidence/);
  assert.match(authContext, /device_evidence/);
  assert.match(collector, /navigator\.geolocation\.getCurrentPosition/);
  assert.match(collector, /enableHighAccuracy:\s*true/);
});

test("Release 3F-A fixes Mining and System Operations sidebar icons and page", () => {
  const mining = read("frontend/src/layouts/MiningLayout.jsx");
  const layout = read("frontend/src/components/Layout.jsx");
  const systemOperations = read("frontend/src/pages/SystemOperationsPage.jsx");

  assert.match(mining, /⛏️/u);
  assert.doesNotMatch(mining, /\\u\{26CF\}/);
  assert.match(layout, /icon:\s*"🖥️"/u);
  assert.match(systemOperations, /System Operations/);
  assert.match(systemOperations, /Operational Readiness/);
  assert.match(systemOperations, /Production Safety/i);
  assert.match(systemOperations, /systemOperations\.css/);
  assert.doesNotMatch(systemOperations, /JSON\.stringify/);
});

test("Release 3F-A Security Centre returns professional session evidence", () => {
  const route = read("backend/routes/release2FinalRoutes.js");
  const page = read("frontend/src/pages/Release2FinalControlPage.jsx");

  for (const field of [
    "login_method",
    "device_label",
    "browser_name",
    "os_name",
    "location_permission",
    "latitude",
    "longitude",
    "network_country",
  ]) {
    assert.match(route, new RegExp(field));
  }

  assert.match(route, /friendlySessionEvidence/);
  assert.match(page, /Open exact point on map/);
  assert.match(page, /Human-readable device, login method and location evidence/);
});

test("Release 3F-A migration is additive, complete and verifiable", () => {
  const migration = read(
    "database/migrations/20260718_release3fa_authentication_sessions_ux.sql"
  );
  const verification = read(
    "database/migrations/20260718_release3fa_authentication_sessions_ux_verify.sql"
  );

  assert.match(migration, /login_phone_normalized/);
  assert.match(migration, /uq_users_login_phone_normalized/);
  assert.match(migration, /trg_users_release3fa_phone_insert/);
  assert.match(migration, /location_recorded_at/);
  assert.match(migration, /release3fa_authentication_sessions_ux/);
  assert.match(verification, /COUNT\(\*\) = 24/);
  assert.match(verification, /location_recorded_at/);

  assert.doesNotMatch(migration, /DROP\s+TABLE/i);
  assert.doesNotMatch(migration, /TRUNCATE\s+TABLE/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM/i);
  assert.doesNotMatch(migration, /CREATE\s+DATABASE|DROP\s+DATABASE|USE\s+/i);
});
