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
  "Security Centre exposes the complete Owner MFA workflow",
  () => {
    const source = read(
      "frontend/src/pages/Release2FinalControlPage.jsx"
    );

    for (const marker of [
      "Authenticator MFA Enrollment",
      "/security/owner-readiness",
      "/security/owner-login-history",
      "/security/break-glass/mfa/start",
      "/security/break-glass/mfa/confirm",
      "/security/break-glass/recovery-codes/rotate",
      "Save Recovery Codes Now",
      "Download Recovery Codes",
      "Owner Login History",
    ]) {
      assert.match(
        source,
        new RegExp(
          marker.replace(
            /[.*+?^$()|[\]\\]/g,
            "\\$&"
          )
        )
      );
    }
  }
);

test(
  "Owner Recovery requires one protected second factor",
  () => {
    const source = read(
      "frontend/src/pages/OwnerRecoveryPage.jsx"
    );

    assert.match(
      source,
      /mfa_code/
    );

    assert.match(
      source,
      /recovery_code/
    );

    assert.match(
      source,
      /Use emergency recovery code/
    );

    assert.match(
      source,
      /\/owner\/login-history/
    );

    assert.match(
      source,
      /Owner Login Evidence/
    );

    assert.doesNotMatch(
      source,
      /localStorage.*owner/i
    );
  }
);
