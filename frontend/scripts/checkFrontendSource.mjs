import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

const indexHtml = read("index.html");
const app = read("src/App.jsx");
const authContext = read("src/context/AuthContext.jsx");
const newSale = read("src/pages/NewSalePage.jsx");
const salesHistory = read("src/pages/SalesHistoryPage.jsx");
const productsPage = read("src/pages/ProductsPage.jsx");
const smsPage = read("src/pages/SmsPage.jsx");

assert.match(indexHtml, /Chalin 03 Group Operations Platform/);
assert.doesNotMatch(indexHtml, /https:\/\/chalin03\.com/);
assert.match(app, /SystemOperationsPage/);
assert.match(app, /system-operations/);
assert.match(app, /PermissionRoute/);
assert.match(app, /MINING_SECTION_PERMISSIONS/);
assert.match(app, /HIRE_SECTION_PERMISSIONS/);
assert.match(authContext, /effective_permissions/);
assert.match(authContext, /hasPermission/);
assert.match(authContext, /workspaceRole/);
assert.match(newSale, /QUALITY PARTS. RELIABLE SERVICE. BUILT ON TRUST./);
assert.match(salesHistory, /QUALITY PARTS. RELIABLE SERVICE. BUILT ON TRUST./);
assert.match(productsPage, /\/products\/\$\{restockProduct\.id\}\/restock/);
assert.match(productsPage, /Receive \/ Restock/);
assert.match(productsPage, /Adjust \/ Correct/);
assert.match(productsPage, /delete productData\.quantity/);
assert.match(smsPage, /Accepted by provider/);
assert.match(smsPage, /Delivery unknown/);
assert.match(smsPage, /Do not retry/);
assert.doesNotMatch(smsPage, /Sent SMS/);

console.log("PASS - frontend static source checks completed.");
