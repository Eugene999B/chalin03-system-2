const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const projectRoot = join(__dirname, "..", "..");

function read(relativePath) {
  return readFileSync(
    join(projectRoot, relativePath),
    "utf8"
  );
}

test(
  "Release 3 reports truthful Owner Break-Glass readiness",
  () => {
    const routes = read(
      "backend/routes/release2FinalRoutes.js"
    );
    const login = read(
      "frontend/src/pages/LoginPage.jsx"
    );
    const control = read(
      "frontend/src/pages/Release2FinalControlPage.jsx"
    );

    assert.match(
      routes,
      /owner_security_readiness/
    );

    assert.match(
      routes,
      /configured_without_mfa/
    );

    assert.match(
      routes,
      /fully_protected:\s*false/
    );

    assert.match(
      control,
      /Owner protection/
    );

    assert.match(
      control,
      /Group Security/
    );

    assert.doesNotMatch(
      login,
      /until the Owner Break-Glass feature is\s+released/i
    );
  }
);
