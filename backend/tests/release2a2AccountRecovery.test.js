const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

process.env.ACCOUNT_RECOVERY_OTP_SECRET =
  process.env.ACCOUNT_RECOVERY_OTP_SECRET ||
  "release2a2-test-secret-that-is-not-used-in-production";

const root = join(__dirname, "..");

function read(relativePath) {
  return readFileSync(
    join(root, relativePath),
    "utf8"
  );
}

const {
  MAX_FAILED_LOGIN_ATTEMPTS,
  OTP_HOURLY_LIMIT,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_SECONDS,
  OTP_TTL_MINUTES,
  calculateFailedLoginState,
  generateOtp,
  hashOtp,
  isOriginalSystemAdministrator,
  maskPhone,
  strongPasswordError,
  verifyOtp,
} = require("../services/accountRecoveryService");

test("ordinary account locks on exactly the third failed password", () => {
  assert.equal(MAX_FAILED_LOGIN_ATTEMPTS, 3);

  const first = calculateFailedLoginState({
    currentAttempts: 0,
    originalSystemAdministrator: false,
  });

  const second = calculateFailedLoginState({
    currentAttempts: 1,
    originalSystemAdministrator: false,
  });

  const third = calculateFailedLoginState({
    currentAttempts: 2,
    originalSystemAdministrator: false,
  });

  assert.equal(first.attempts, 1);
  assert.equal(first.locked, false);
  assert.equal(second.attempts, 2);
  assert.equal(second.locked, false);
  assert.equal(third.attempts, 3);
  assert.equal(third.locked, true);
});

test("original System Administrator is exempt until Break-Glass exists", () => {
  const state = calculateFailedLoginState({
    currentAttempts: 2,
    originalSystemAdministrator: true,
  });

  assert.equal(state.locked, false);
  assert.equal(
    state.protected_original_admin,
    true
  );

  assert.equal(
    isOriginalSystemAdministrator({
      id: 1,
      username: "admin",
      role: "admin",
    }),
    true
  );
});

test("OTP is six numeric digits and is verified through a hash", () => {
  const otp = generateOtp();
  const salt = "00112233445566778899aabbccddeeff";

  assert.match(otp, /^\d{6}$/);

  const otpHash = hashOtp({
    userId: 7,
    otp,
    salt,
  });

  assert.equal(otpHash.length, 64);
  assert.equal(otpHash.includes(otp), false);

  assert.equal(
    verifyOtp({
      userId: 7,
      otp,
      salt,
      expectedHash: otpHash,
    }),
    true
  );

  assert.equal(
    verifyOtp({
      userId: 7,
      otp: "999999",
      salt,
      expectedHash: otpHash,
    }),
    false
  );
});

test("approved OTP limits remain fixed", () => {
  assert.equal(OTP_TTL_MINUTES, 5);
  assert.equal(OTP_MAX_ATTEMPTS, 5);
  assert.equal(OTP_RESEND_SECONDS, 60);
  assert.equal(OTP_HOURLY_LIMIT, 3);
});

test("registered phone is masked and strong passwords are required", () => {
  assert.equal(
    maskPhone("0241234567"),
    "024***4567"
  );

  assert.match(
    strongPasswordError("weak"),
    /8 characters/
  );

  assert.equal(
    strongPasswordError("Strong#Pass9"),
    ""
  );
});

test("authentication routes expose locked-account and OTP recovery controls", () => {
  const source = read("routes/authRoutes.js");

  assert.match(source, /ACCOUNT_LOCKED/);
  assert.match(
    source,
    /recordFailedLoginAttempt/
  );
  assert.match(
    source,
    /\/recovery\/request-otp/
  );
  assert.match(
    source,
    /\/recovery\/reset-password/
  );
  assert.match(
    source,
    /GENERIC_RECOVERY_REQUEST_MESSAGE/
  );
});

test("administrator reset routes use the original-System-Administrator service", () => {
  const userRoutes = read(
    "routes/userRoutes.js"
  );

  const workspaceRoutes = read(
    "routes/workspaceAdminRoutes.js"
  );

  assert.match(
    userRoutes,
    /resetAccountBySystemAdministrator/
  );

  assert.match(
    workspaceRoutes,
    /resetAccountBySystemAdministrator/
  );

  assert.doesNotMatch(
    workspaceRoutes,
    /forcePasswordChange\s*=\s*req\.body/
  );
});

test("OTP message is redacted from SMS history", () => {
  const service = read(
    "services/smsAlertService.js"
  );

  const recovery = read(
    "services/accountRecoveryService.js"
  );

  assert.match(
    service,
    /redactSecretFromProviderResponse/
  );

  assert.match(
    recovery,
    /intentionally redacted from SMS history/
  );

  assert.match(
    recovery,
    /temporary_password_recorded:\s*false/
  );
});

test("Release 2A.2 migration is additive and does not delete business records", () => {
  const migration = read(
    "../database/migrations/20260716_release2a2_account_lock_otp.sql"
  );

  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS password_recovery_otps/
  );

  assert.match(
    migration,
    /is_login_locked BOOLEAN/
  );

  assert.doesNotMatch(
    migration,
    /DROP TABLE/i
  );

  assert.doesNotMatch(
    migration,
    /TRUNCATE/i
  );

  assert.doesNotMatch(
    migration,
    /DELETE FROM (sales|products|customers|debts|expenses|purchases)/i
  );
});