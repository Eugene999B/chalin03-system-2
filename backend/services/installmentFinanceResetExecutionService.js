const bcrypt = require("bcryptjs");
const { pool } = require("../config/db");
const { RESET_CONFIRMATION, buildDryRun } = require("./installmentFinanceLiveResetService");

function placeholders(values) { return values.map(() => "?").join(","); }

async function tableExists(connection, tableName) {
  const [[row]] = await connection.query(`SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [tableName]);
  return Number(row?.count || 0) === 1;
}

async function getColumns(connection, tableName) {
  if (!(await tableExists(connection, tableName))) return new Map();
  const [rows] = await connection.query(`SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [tableName]);
  return new Map(rows.map((row) => [String(row.COLUMN_NAME), row]));
}

async function verifyPassword(connection, userId, password) {
  const [[user]] = await connection.query("SELECT id, password_hash, is_active FROM users WHERE id = ? LIMIT 1", [userId]);
  if (!user || Number(user.is_active) !== 1 || !user.password_hash) {
    const error = new Error("Current password could not be verified."); error.statusCode = 401; error.code = "RESET_PASSWORD_INVALID"; throw error;
  }
  if (!(await bcrypt.compare(String(password || ""), String(user.password_hash)))) {
    const error = new Error("The current password is incorrect."); error.statusCode = 401; error.code = "RESET_PASSWORD_INVALID"; throw error;
  }
}

async function deleteByIds(connection, tableName, columnName, ids, deleted) {
  if (!ids.length) return;
  const columns = await getColumns(connection, tableName);
  if (!columns.has(columnName)) return;
  const [result] = await connection.query(`DELETE FROM \`${tableName}\` WHERE \`${columnName}\` IN (${placeholders(ids)})`, ids);
  deleted.push({ table: tableName, rows: Number(result.affectedRows || 0) });
}

async function clearInstallmentChildTable(connection, tableName, { agreementIds, applicationIds, paymentIds }, deleted) {
  if (!(await tableExists(connection, tableName))) return;
  const columns = await getColumns(connection, tableName);
  const candidates = [["agreement_id", agreementIds], ["sale_agreement_id", agreementIds], ["installment_agreement_id", agreementIds], ["application_id", applicationIds], ["credit_application_id", applicationIds], ["payment_id", paymentIds], ["sale_payment_id", paymentIds]];
  for (const [column, ids] of candidates) {
    if (columns.has(column) && ids.length) { await deleteByIds(connection, tableName, column, ids, deleted); return; }
  }
}

async function findRestorableValue(connection, tableName, columnName, excludedValues, assetIds = []) {
  const columns = await getColumns(connection, tableName); const meta = columns.get(columnName); if (!meta) return null;
  const excluded = (excludedValues || []).map((value) => String(value).toLowerCase());
  const idFilter = assetIds.length ? `AND id NOT IN (${placeholders(assetIds)})` : "";
  if (columns.has("id")) {
    const [rows] = await connection.query(`SELECT \`${columnName}\` AS value FROM \`${tableName}\` WHERE \`${columnName}\` IS NOT NULL ${idFilter} GROUP BY \`${columnName}\` ORDER BY COUNT(*) DESC, \`${columnName}\` ASC LIMIT 20`, assetIds);
    const observed = rows.find((row) => !excluded.includes(String(row.value).toLowerCase()));
    if (observed?.value !== undefined && observed?.value !== null) return String(observed.value);
  }
  const type = String(meta.COLUMN_TYPE || "");
  if (/^enum\(/i.test(type)) {
    const values = [...type.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((match) => match[1].replace(/\\'/g, "'"));
    const preferred = ["available", "active", "in_stock", "instock", "idle", "ready", "free", "unsold", "stock", "open"];
    const preferredValue = preferred.find((candidate) => values.some((value) => value.toLowerCase() === candidate && !excluded.includes(candidate)));
    if (preferredValue) return values.find((value) => value.toLowerCase() === preferredValue);
    const candidate = values.find((value) => !excluded.includes(value.toLowerCase())); if (candidate) return candidate;
  }
  if (meta.COLUMN_DEFAULT !== null && meta.COLUMN_DEFAULT !== undefined) { const candidate = String(meta.COLUMN_DEFAULT); if (candidate && !excluded.includes(candidate.toLowerCase())) return candidate; }
  return null;
}

async function restoreFinanceAssets(connection, assetIds, deleted) {
  if (!assetIds.length || !(await tableExists(connection, "fleet_assets"))) return;
  const columns = await getColumns(connection, "fleet_assets"); const updates = []; const params = []; const excluded = ["sold", "reserved", "installment", "rented", "hire"];
  if (columns.has("sale_status")) { const value = await findRestorableValue(connection, "fleet_assets", "sale_status", excluded, assetIds); if (value !== null) { updates.push("`sale_status` = ?"); params.push(value); } }
  if (columns.has("current_status")) { const value = await findRestorableValue(connection, "fleet_assets", "current_status", excluded, assetIds); if (value !== null) { updates.push("`current_status` = ?"); params.push(value); } }
  if (columns.has("sold_at") && String(columns.get("sold_at").IS_NULLABLE).toUpperCase() === "YES") updates.push("`sold_at` = NULL");
  if (!updates.length || !columns.has("id")) return;
  const [result] = await connection.query(`UPDATE fleet_assets SET ${updates.join(", ")} WHERE id IN (${placeholders(assetIds)})`, [...params, ...assetIds]);
  deleted.push({ table: "fleet_assets", restored_rows: Number(result.affectedRows || 0) });
}

async function selectAgreements(connection) {
  if (!(await tableExists(connection, "equipment_sale_agreements"))) return { rows: [], columns: new Map() };
  const columns = await getColumns(connection, "equipment_sale_agreements"); if (!columns.has("id")) return { rows: [], columns };
  const select = ["id"]; for (const c of ["asset_id", "credit_application_id", "customer_id", "customerId", "customer_id"] ) if (columns.has(c) && !select.includes(c)) select.push(c);
  const where = columns.has("sale_type") ? "WHERE sale_type = 'installment'" : "";
  const [rows] = await connection.query(`SELECT ${select.join(", ")} FROM equipment_sale_agreements ${where} FOR UPDATE`);
  return { rows, columns };
}

async function selectApplications(connection, applicationIds) {
  if (!applicationIds.length || !(await tableExists(connection, "equipment_credit_applications"))) return { rows: [], columns: new Map() };
  const columns = await getColumns(connection, "equipment_credit_applications"); if (!columns.has("id")) return { rows: [], columns };
  const select = ["id"]; for (const c of ["quotation_id", "customer_id", "customerId", "excavator_id", "equipment_id", "asset_id"]) if (columns.has(c) && !select.includes(c)) select.push(c);
  const [rows] = await connection.query(`SELECT ${select.join(", ")} FROM equipment_credit_applications WHERE id IN (${placeholders(applicationIds)}) FOR UPDATE`, applicationIds);
  return { rows, columns };
}

function addIds(target, rows, columns, names) {
  for (const name of names) if (columns.has(name)) for (const row of rows) { const value = Number(row[name]); if (Number.isInteger(value) && value > 0) target.add(value); }
}

async function getCandidateParentTables(connection, kind) {
  const patterns = kind === "customer" ? ["%customer%"] : ["%excavat%", "%equipment%"];
  const conditions = patterns.map(() => "TABLE_NAME LIKE ?").join(" OR ");
  const [rows] = await connection.query(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND (${conditions})`, patterns);
  return rows.map((r) => String(r.TABLE_NAME)).filter((name) => !name.startsWith("equipment_finance_") && !name.includes("quotation"));
}

async function hasExternalReferences(connection, tableName, ids) {
  if (!ids.length) return true;
  const [refs] = await connection.query(`SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = ? AND REFERENCED_COLUMN_NAME = 'id' AND TABLE_NAME <> ?`, [tableName, tableName]);
  for (const ref of refs) {
    if (!(await tableExists(connection, ref.TABLE_NAME))) continue;
    const columns = await getColumns(connection, ref.TABLE_NAME); if (!columns.has(ref.COLUMN_NAME)) continue;
    const [[row]] = await connection.query(`SELECT COUNT(*) AS count FROM \`${ref.TABLE_NAME}\` WHERE \`${ref.COLUMN_NAME}\` IN (${placeholders(ids)})`, ids);
    if (Number(row?.count || 0) > 0) return true;
  }
  return false;
}

async function purgeOwnedParents(connection, customerIds, excavatorIds, deleted) {
  // Parent/master rows are removed only when they are no longer referenced by
  // any other table. This makes the purge Installment-only and protects Hiring.
  const targets = [
    { kind: "customer", ids: [...customerIds], columns: ["id"] },
    { kind: "excavator", ids: [...excavatorIds], columns: ["id", "asset_id", "equipment_id"] },
  ];
  for (const target of targets) {
    if (!target.ids.length) continue;
    const tables = await getCandidateParentTables(connection, target.kind);
    for (const table of tables) {
      const columns = await getColumns(connection, table); if (!columns.has("id")) continue;
      const ids = target.ids;
      const existing = [];
      const [rows] = await connection.query(`SELECT id FROM \`${table}\` WHERE id IN (${placeholders(ids)})`, ids);
      for (const row of rows) existing.push(Number(row.id));
      if (!existing.length || await hasExternalReferences(connection, table, existing)) continue;
      await deleteByIds(connection, table, "id", existing, deleted);
    }
  }
}

async function executeReset({ userId, password, confirmation, dryRunFingerprint, connection = null } = {}) {
  if (String(confirmation || "").trim() !== RESET_CONFIRMATION) { const error = new Error(`Type ${RESET_CONFIRMATION} exactly to confirm the Installment reset.`); error.statusCode = 400; error.code = "RESET_CONFIRMATION_REQUIRED"; throw error; }
  const ownsConnection = !connection; const db = connection || (await pool.getConnection());
  try {
    await verifyPassword(db, userId, password);
    const dryRun = await buildDryRun(db);
    if (!dryRunFingerprint || dryRunFingerprint !== dryRun.fingerprint) { const error = new Error("The reset scope changed. Prepare a new dry run before executing the reset."); error.statusCode = 409; error.code = "RESET_DRY_RUN_STALE"; throw error; }
    await db.beginTransaction();

    const { rows: agreements, columns: agreementColumns } = await selectAgreements(db);
    const agreementIds = agreements.map((row) => Number(row.id)).filter(Number.isInteger);
    const assetIds = agreementColumns.has("asset_id") ? agreements.map((row) => Number(row.asset_id)).filter(Number.isInteger) : [];
    const agreementApplicationIds = agreementColumns.has("credit_application_id") ? agreements.map((row) => Number(row.credit_application_id)).filter(Number.isInteger) : [];
    const customerIds = new Set(); const excavatorIds = new Set();
    addIds(customerIds, agreements, agreementColumns, ["customer_id", "customerId"]);

    const { rows: applications } = await selectApplications(db, [...new Set(agreementApplicationIds)]);
    const applicationIds = [...new Set(agreementApplicationIds)];
    addIds(customerIds, applications, (await getColumns(db, "equipment_credit_applications")), ["customer_id", "customerId"]);
    addIds(excavatorIds, applications, (await getColumns(db, "equipment_credit_applications")), ["excavator_id", "equipment_id", "asset_id"]);
    const quotationIds = applications.map((row) => Number(row.quotation_id)).filter(Number.isInteger);

    const [paymentRows] = agreementIds.length && (await tableExists(db, "equipment_sale_payments")) ? await db.query(`SELECT id FROM equipment_sale_payments WHERE agreement_id IN (${placeholders(agreementIds)}) FOR UPDATE`, agreementIds) : [[]];
    const paymentIds = paymentRows.map((row) => Number(row.id)).filter(Number.isInteger);
    const deleted = [];
    const childTables = ["equipment_finance_case_activity", "equipment_finance_documents", "equipment_finance_private_documents", "equipment_finance_document_reviews", "equipment_finance_delivery_authorizations", "equipment_finance_delivery_confirmations", "equipment_finance_correction_requests", "equipment_finance_correction_ledger", "equipment_installment_schedule", "equipment_sale_payment_allocations", "equipment_sale_payments", "equipment_deliveries", "equipment_ownership_transfers", "equipment_asset_sale_locks"];
    if (agreementIds.length) { for (const table of childTables) await clearInstallmentChildTable(db, table, { agreementIds, applicationIds, paymentIds }, deleted); await deleteByIds(db, "equipment_sale_agreements", "id", agreementIds, deleted); }
    if (applicationIds.length) { for (const table of ["equipment_credit_application_kyc", "equipment_credit_application_reviews", "equipment_credit_application_affordability", "equipment_credit_application_guarantors", "equipment_credit_application_consents"]) await clearInstallmentChildTable(db, table, { agreementIds, applicationIds, paymentIds }, deleted); await deleteByIds(db, "equipment_credit_applications", "id", applicationIds, deleted); }
    if (quotationIds.length) { await deleteByIds(db, "equipment_sales_quotation_items", "quotation_id", quotationIds, deleted); await deleteByIds(db, "equipment_sales_quotations", "id", quotationIds, deleted); }
    await restoreFinanceAssets(db, assetIds, deleted);
    await purgeOwnedParents(db, customerIds, new Set([...excavatorIds, ...assetIds]), deleted);
    await db.commit();
    return { status: "success", mode: "installment_reset", dry_run_fingerprint: dryRun.fingerprint, deleted, message: "Installment Finance data and unreferenced Installment-owned customer/excavator records were reset. Records still referenced by Hiring or another module were preserved." };
  } catch (error) { try { await db.rollback(); } catch (_) {} throw error; }
  finally { if (ownsConnection) db.release(); }
}

module.exports = { executeReset };
