import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const page = read("src/pages/EquipmentFinanceTaskInboxPage.jsx");
const css = read("src/styles/equipmentFinanceTaskInbox.css");

assert.match(page, /What needs attention now/);
assert.match(page, /Approvals & review/);
assert.match(page, /Data & document issues/);
assert.match(page, /Open case/);
assert.match(page, /stage: "case-operations"/);
assert.match(page, /inbox_page_size: PAGE_SIZE/);
assert.match(page, /All priorities/);
assert.doesNotMatch(page, /Open case operation/);

assert.match(css, /\.task-inbox__row/);
assert.match(css, /grid-template-columns: 28px minmax\(0, 1fr\) 132px/);
assert.match(css, /\.task-inbox__priority-filters/);
assert.match(css, /\.task-inbox__row-main > p/);
assert.match(css, /-webkit-line-clamp: 2/);
assert.match(css, /@media \(max-width: 900px\)/);
assert.match(css, /@media \(max-width: 680px\)/);

console.log("Finance task inbox layout contracts passed");
