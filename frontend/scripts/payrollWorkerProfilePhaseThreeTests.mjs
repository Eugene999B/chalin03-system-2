import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const profile = read("src/pages/ExpandedWorkerProfilePage.jsx");

assert.match(profile, /Salary & Payroll/);

console.log("Payroll Worker Profile Phase 3 source contract passed.");
