const test = require("node:test");
const assert = require("node:assert/strict");

const { escapeCsvFormula, rowsToCsv } = require("../utils/csvSafety");

test("CSV formula-leading values are escaped", () => {
  assert.equal(escapeCsvFormula("=SUM(A1:A2)"), "'=SUM(A1:A2)");
  assert.equal(escapeCsvFormula("+CMD"), "'+CMD");
  assert.equal(escapeCsvFormula("-10"), "'-10");
  assert.equal(escapeCsvFormula("@user"), "'@user");
  assert.equal(escapeCsvFormula("normal text"), "normal text");
});

test("rowsToCsv quotes cells and escapes dangerous values", () => {
  const csv = rowsToCsv(
    [
      { key: "name", label: "Name" },
      { key: "note", label: "Note" },
    ],
    [{ name: "Alice", note: "=HYPERLINK(\"bad\")" }]
  );

  assert.match(csv, /"Name","Note"/);
  assert.match(csv, /"Alice","'=HYPERLINK\(""bad""\)"/);
});
