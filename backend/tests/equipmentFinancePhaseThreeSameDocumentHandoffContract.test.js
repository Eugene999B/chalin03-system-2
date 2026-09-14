const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../frontend/src/pages/EquipmentFinancePhaseThreeStartRedirectPage.jsx"
  ),
  "utf8"
);

test("committed Finance creation changes the real URL without restarting authentication", () => {
  assert.match(source, /function replaceFinanceLocation\(nextPath\)/);
  assert.match(source, /window\.history\.replaceState\(window\.history\.state, "", nextPath\)/);
  assert.match(source, /new PopStateEvent\("popstate", \{ state: window\.history\.state \}\)/);
  assert.match(source, /replaceFinanceLocation\(safeNextPath\(response\)\)/);
  assert.match(source, /same authenticated document/);
});

test("the handoff is one-shot and never reloads the live document", () => {
  assert.match(source, /let redirecting = false/);
  assert.match(source, /if \(!redirecting && successfulCreation\(response\)\)/);
  const executable = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  assert.doesNotMatch(executable, /window\.location\.(?:replace|assign)\(/);
  assert.doesNotMatch(executable, /window\.location\.href\s*=/);
});
