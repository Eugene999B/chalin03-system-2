const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const {
  base32Encode,
  buildOtpAuthUri,
  decryptMfaSecret,
  encryptMfaSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  totpAt,
  verifyTotpCode,
} = require("../services/ownerMfaService");

process.env.OWNER_MFA_ENCRYPTION_KEY =
  "release3-test-only-owner-mfa-encryption-key-123456789";

test(
  "Owner MFA secret is encrypted and decrypts correctly",
  () => {
    const encrypted =
      encryptMfaSecret(
        "JBSWY3DPEHPK3PXP"
      );

    assert.notEqual(
      encrypted.ciphertext,
      "JBSWY3DPEHPK3PXP"
    );

    assert.equal(
      decryptMfaSecret(encrypted),
      "JBSWY3DPEHPK3PXP"
    );
  }
);

test(
  "TOTP implementation matches the RFC 6238 SHA1 example",
  () => {
    const secret = base32Encode(
      Buffer.from(
        "12345678901234567890",
        "ascii"
      )
    );

    assert.equal(
      totpAt(secret, {
        timestamp: 59000,
        digits: 8,
      }),
      "94287082"
    );
  }
);

test(
  "Owner TOTP verification accepts only the correct time code",
  () => {
    const secret =
      "JBSWY3DPEHPK3PXP";

    const timestamp =
      1_700_000_000_000;

    const code = totpAt(secret, {
      timestamp,
    });

    assert.equal(
      verifyTotpCode(secret, code, {
        timestamp,
      }),
      true
    );

    assert.equal(
      verifyTotpCode(
        secret,
        "000000",
        { timestamp }
      ),
      false
    );
  }
);

test(
  "Owner recovery codes are unique and stored through hashes",
  () => {
    const codes =
      generateRecoveryCodes(8);

    assert.equal(codes.length, 8);
    assert.equal(
      new Set(codes).size,
      8
    );

    const hash =
      hashRecoveryCode(codes[0]);

    assert.equal(hash.length, 64);
    assert.doesNotMatch(
      hash,
      new RegExp(codes[0])
    );
  }
);

test(
  "Authenticator URI contains no password",
  () => {
    const uri = buildOtpAuthUri({
      secret:
        "JBSWY3DPEHPK3PXP",
      username: "private-owner",
    });

    assert.match(
      uri,
      /^otpauth:\/\/totp\//
    );

    assert.match(
      uri,
      /secret=JBSWY3DPEHPK3PXP/
    );

    assert.doesNotMatch(
      uri,
      /password/i
    );
  }
);

test(
  "Release 3 Owner MFA migration is additive",
  () => {
    const migration = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "database",
        "migrations",
        "20260716_release3_owner_mfa_security.sql"
      ),
      "utf8"
    );

    for (const marker of [
      "mfa_enabled",
      "mfa_secret_ciphertext",
      "owner_break_glass_recovery_codes",
      "owner_break_glass_login_history",
      "release3_owner_mfa_security",
    ]) {
      assert.match(
        migration,
        new RegExp(marker)
      );
    }

    assert.doesNotMatch(
      migration,
      /\bDROP\s+TABLE\b/i
    );

    assert.doesNotMatch(
      migration,
      /\bTRUNCATE\b/i
    );

    assert.doesNotMatch(
      migration,
      /\bDELETE\s+FROM\b/i
    );
  }
);
