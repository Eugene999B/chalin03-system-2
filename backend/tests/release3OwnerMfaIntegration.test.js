const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const projectRoot = join(
  __dirname,
  "..",
  ".."
);

function read(relativePath) {
  return readFileSync(
    join(
      projectRoot,
      relativePath
    ),
    "utf8"
  );
}

test(
  "Release 3 Owner Security router overrides password-only recovery",
  () => {
    const server = read(
      "backend/server.js"
    );

    const ownerRoutes = read(
      "backend/routes/ownerSecurityRoutes.js"
    );

    assert.match(
      server,
      /ownerSecurityRoutes/
    );

    assert.ok(
      server.indexOf(
        'app.use("/api/release2-final", ownerSecurityRoutes)'
      ) <
        server.indexOf(
          'app.use("/api/release2-final", release2FinalRoutes)'
        ),
      "Owner Security routes must be mounted before the legacy routes."
    );

    for (const marker of [
      "/security/owner-readiness",
      "/security/break-glass/mfa/start",
      "/security/break-glass/mfa/confirm",
      "/security/break-glass/recovery-codes/rotate",
      "/owner/login",
      "/owner/login-history",
      "verifyTotpCode",
      "hashRecoveryCode",
      "owner_break_glass_login_history",
      "fully_protected",
    ]) {
      assert.match(
        ownerRoutes,
        new RegExp(
          marker.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
          )
        )
      );
    }

    assert.match(
      ownerRoutes,
      /passwords_or_codes_recorded:\s*false/
    );

    assert.doesNotMatch(
      ownerRoutes,
      /passwords_or_codes_recorded:\s*true/
    );
  }
);

test(
  "Release 3 MFA enrollment is staged before activation",
  () => {
    const migration = read(
      "database/migrations/20260716_release3_owner_mfa_security.sql"
    );

    const routes = read(
      "backend/routes/ownerSecurityRoutes.js"
    );

    assert.match(
      migration,
      /owner_break_glass_mfa_enrollments/
    );

    assert.match(
      migration,
      /token_hash CHAR\(64\) NOT NULL UNIQUE/
    );

    assert.match(
      routes,
      /MFA_ENROLLMENT_MINUTES/
    );

    assert.match(
      routes,
      /enrollment_token/
    );

    assert.match(
      routes,
      /confirmed_at = NOW\(\)/
    );
  }
);

test(
  "Release 3 owner-security migration remains additive",
  () => {
    const migration = read(
      "database/migrations/20260716_release3_owner_mfa_security.sql"
    );

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
      /\bDELETE\s+FROM\s+(sales|products|customers|debts|expenses|purchases)\b/i
    );
  }
);
