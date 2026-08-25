const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "routes", "equipmentFinanceDepositReservationRoutes.js");
let source = fs.readFileSync(file, "utf8");
const old = `async function ensureDepositFoundationReady() {\n  const current = await schemaStatus(pool);\n  if (current.ready) return current;`;
const replacement = `async function ensureDepositFoundationReady() {\n  const current = await schemaStatus(pool);\n  const repairRequired =\n    current.missing_columns.length > 0 ||\n    current.missing_triggers.length > 0 ||\n    current.invalid_triggers.length > 0 ||\n    current.missing_migrations.length > 0;\n  if (!repairRequired) return current;`;
if (!source.includes(old)) throw new Error("Opening Deposit foundation-ready condition was not found.");
source = source.replace(old, replacement);
fs.writeFileSync(file, source);
console.log("Opening Deposit foundation repair condition corrected.");
