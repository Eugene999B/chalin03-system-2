const crypto = require("crypto");
const { pool } = require("../config/db");
const { collectImpact } = require("./installmentUnifiedDeletionServiceV1");

const FINANCE_WORKSPACE = "equipment_installment_finance";
const RESET_CONFIRMATION = "RESET INSTALLMENT FINANCE";

async function buildDryRun(connection = pool) {
  const { scope, impact } = await collectImpact(connection);
  const payload = {
    workspace: FINANCE_WORKSPACE,
    mode: "installment_reset_dry_run_unified_v1",
    impact,
    ownership_scope: {
      customers: scope.customers.length,
      excavators: scope.assets.length,
      applications: scope.applications.length,
      agreements: scope.agreements.length,
      payments: scope.payments.length,
      quotations: scope.quotations.length,
    },
    preserves: [
      "Hiring records and contracts",
      "Mining records",
      "Spare Parts records",
      "users and permissions",
      "audit history",
      "Finance configuration and settings",
      "shared customer/excavator masters that are not explicitly Installment-owned or are still referenced by another module",
    ],
    confirmation_phrase: RESET_CONFIRMATION,
  };
  return {
    ...payload,
    fingerprint: crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
  };
}

module.exports = { FINANCE_WORKSPACE, RESET_CONFIRMATION, buildDryRun };
