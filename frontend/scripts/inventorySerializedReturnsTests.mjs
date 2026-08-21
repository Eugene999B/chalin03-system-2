import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (relative) => readFileSync(join(root, relative), "utf8");

const returnsPage = read("src/pages/ReturnsPage.jsx");
const multiReturn = read("src/components/MultiItemReturnPanel.jsx");
const scanner = read("src/components/InventoryReturnUnitScanner.jsx");

assert.match(returnsPage, /InventoryReturnUnitScanner/);
assert.match(returnsPage, /returnUnitIds/);
assert.match(returnsPage, /serializedReturnRequired/);
assert.match(returnsPage, /serialized_return_requires_unit_ids/);
assert.match(returnsPage, /payload\.unit_ids = returnUnitIds/);
assert.match(returnsPage, /requiredCount=\{Number\(form\.quantity \|\| 0\)\}/);
assert.match(returnsPage, /Returned serialized units are quarantined/i);
assert.match(
  returnsPage,
  /const successMessage =[\s\S]*await Promise\.all[\s\S]*setMessage\(successMessage\)/
);
assert.match(
  returnsPage,
  /async function handleMultiReturnResult[\s\S]*await Promise\.all[\s\S]*setMessage\(result\?\.message/
);

assert.match(multiReturn, /serialized_return_requires_unit_ids/);
assert.match(multiReturn, /Use Single Item Return/i);
assert.match(multiReturn, /serialized exact-ID returns cannot use the multi-item shortcut/i);

assert.match(scanner, /\/inventory-traceability\/return-scan\/verify/);
assert.match(scanner, /same_sale/);
assert.match(scanner, /already_returned/);
assert.match(scanner, /Ready for quarantine/);

console.log("Serialized Returns frontend contract passed.");
