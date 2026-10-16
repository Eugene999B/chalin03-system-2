import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const attention = read("src/components/ApprovalCentreLiveAttention.jsx");
const main = read("src/main.jsx");
const packageJson = read("package.json");

assert.match(attention, /const POLL_INTERVAL_MS = 12000/);
assert.match(attention, /\/audit-unlock-requests\/operational/);
assert.match(attention, /payload\?\.summary\?\.pending/);
assert.match(attention, /payload\?\.summary\?\.failed/);
assert.match(attention, /approval-launcher-has-attention/);
assert.match(attention, /approval-launcher-new-arrival/);
assert.match(attention, /approval-launcher-count/);
assert.match(attention, /aria-live/);
assert.match(attention, /99\+/);
assert.match(attention, /window\.addEventListener\("focus", refreshAttention\)/);
assert.match(attention, /visibilitychange/);
assert.match(attention, /prefers-reduced-motion/);
assert.match(attention, /@media \(max-width: 720px\)/);
assert.match(attention, /env\(safe-area-inset-bottom\)/);
assert.match(attention, /place-items: end stretch/);
assert.match(attention, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
assert.match(attention, /font-size: 16px !important/);
assert.match(attention, /approval-review-modal/);

assert.match(main, /import ApprovalCentreLiveAttention/);
assert.match(main, /<ApprovalCentreLiveAttention \/>/);
assert.match(packageJson, /approvalCentreLiveAttentionTests\.mjs/);

console.log("Approval Centre live attention and mobile contracts passed.");
