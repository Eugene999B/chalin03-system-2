const { pool } = require("../config/db");

const INSTALLMENT_TABLES = [
  "equipment_finance_case_activity",
  "equipment_finance_documents",
  "equipment_finance_private_documents",
  "equipment_finance_document_reviews",
  "equipment_finance_delivery_authorizations",
  "equipment_finance_delivery_confirmations",
  "equipment_finance_correction_requests",
  "equipment_finance_correction_ledger",
  "equipment_installment_schedule",
  "equipment_sale_payment_allocations",
  "equipment_sale_payments",
  "equipment_deliveries",
  "equipment_ownership_transfers",
  "equipment_asset_sale_locks",
  "equipment_credit_application_kyc",
  "equipment_credit_application_reviews",
  "equipment_credit_application_affordability",
  "equipment_credit_application_guarantors",
  "equipment_credit_application_consents",
];

const MASTER_TABLES = [
  "customers",
  "equipment_customers",
  "customer_profiles",
  "equipment_customer_profiles",
  "excavators",
  "equipment_excavators",
  "equipment",
  "equipment_assets",
  "fleet_assets",
];

const CUSTOMER_COLUMNS = ["customer_id", "customerId", "customerID", "client_id", "clientId"];
const ASSET_COLUMNS = ["asset_id", "assetId", "equipment_id", "equipmentId", "excavator_id", "excavatorId", "fleet_asset_id", "fleetAssetId"];
const APP_COLUMNS = ["application_id", "applicationId", "credit_application_id", "creditApplicationId"];
const AGREEMENT_COLUMNS = ["agreement_id", "agreementId", "sale_agreement_id", "installment_agreement_id"];

async function exists(db, table) {
  const [[r]] = await db.query("SELECT COUNT(*) count FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?", [table]);
  return Number(r?.count || 0) === 1;
}

async function cols(db, table) {
  if (!(await exists(db, table))) return new Set();
  const [rows] = await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?", [table]);
  return new Set(rows.map(r => String(r.COLUMN_NAME)));
}

const uniq = values => [...new Set(values.map(Number).filter(Number.isInteger))];
const ph = values => values.map(() => "?").join(",");

async function collect(db) {
  const ids = { customers: new Set(), assets: new Set(), applications: new Set(), agreements: new Set(), payments: new Set(), quotations: new Set() };

  // Dedicated Installment tables are authoritative. Any customer/equipment/application/agreement
  // reference found here belongs to the Installment reset scope.
  for (const table of INSTALLMENT_TABLES) {
    if (!(await exists(db, table))) continue;
    const c = await cols(db, table);
    const select = [...new Set([...CUSTOMER_COLUMNS, ...ASSET_COLUMNS, ...APP_COLUMNS, ...AGREEMENT_COLUMNS, "payment_id", "sale_payment_id", "quotation_id"])]
      .filter(x => c.has(x));
    if (!select.length) continue;
    const [rows] = await db.query(`SELECT ${select.map(x => `\`${x}\``).join(",")} FROM \`${table}\``);
    for (const row of rows) {
      for (const x of CUSTOMER_COLUMNS) if (row[x] != null) ids.customers.add(Number(row[x]));
      for (const x of ASSET_COLUMNS) if (row[x] != null) ids.assets.add(Number(row[x]));
      for (const x of APP_COLUMNS) if (row[x] != null) ids.applications.add(Number(row[x]));
      for (const x of AGREEMENT_COLUMNS) if (row[x] != null) ids.agreements.add(Number(row[x]));
      for (const x of ["payment_id", "sale_payment_id"]) if (row[x] != null) ids.payments.add(Number(row[x]));
      if (row.quotation_id != null) ids.quotations.add(Number(row.quotation_id));
    }
  }

  // Agreements are classified as Installment either by an explicit type/mode OR by being
  // referenced from an Installment-specific child table. This avoids the old sale_type='installment' trap.
  if (await exists(db, "equipment_sale_agreements")) {
    const c = await cols(db, "equipment_sale_agreements");
    if (c.has("id")) {
      const select = ["id", ...["customer_id","customerId","asset_id","assetId","equipment_id","excavator_id","credit_application_id","application_id"].filter(x => c.has(x))];
      let where = "";
      const typeCol = ["sale_type","saleType","sale_mode","saleMode","payment_type","paymentType","finance_type","financeType"].find(x => c.has(x));
      if (typeCol) where = `WHERE LOWER(CAST(\`${typeCol}\` AS CHAR)) IN ('installment','instalment','finance','financed','credit')`;
      const [rows] = await db.query(`SELECT ${select.map(x => `\`${x}\``).join(",")} FROM equipment_sale_agreements ${where}`);
      for (const row of rows) {
        ids.agreements.add(Number(row.id));
        for (const x of ["customer_id","customerId"]) if (row[x] != null) ids.customers.add(Number(row[x]));
        for (const x of ["asset_id","assetId","equipment_id","excavator_id"]) if (row[x] != null) ids.assets.add(Number(row[x]));
        for (const x of ["credit_application_id","application_id"]) if (row[x] != null) ids.applications.add(Number(row[x]));
      }
    }
  }

  if (await exists(db, "equipment_credit_applications") && ids.applications.size) {
    const c = await cols(db, "equipment_credit_applications");
    const appIds = uniq([...ids.applications]);
    const select = ["id", ...["customer_id","customerId","asset_id","assetId","equipment_id","excavator_id","quotation_id"].filter(x => c.has(x))];
    const [rows] = await db.query(`SELECT ${select.map(x => `\`${x}\``).join(",")} FROM equipment_credit_applications WHERE id IN (${ph(appIds)})`, appIds);
    for (const row of rows) {
      for (const x of ["customer_id","customerId"]) if (row[x] != null) ids.customers.add(Number(row[x]));
      for (const x of ["asset_id","assetId","equipment_id","excavator_id"]) if (row[x] != null) ids.assets.add(Number(row[x]));
      if (row.quotation_id != null) ids.quotations.add(Number(row.quotation_id));
    }
  }

  return Object.fromEntries(Object.entries(ids).map(([k,v]) => [k, uniq([...v])]));
}

async function deleteBy(db, table, column, values, deleted) {
  if (!values.length || !(await exists(db, table))) return;
  const c = await cols(db, table);
  if (!c.has(column)) return;
  const [r] = await db.query(`DELETE FROM \`${table}\` WHERE \`${column}\` IN (${ph(values)})`, values);
  if (r.affectedRows) deleted.push({ table, rows: Number(r.affectedRows), column });
}

async function deleteScoped(db, table, ids, deleted) {
  if (!(await exists(db, table))) return;
  const c = await cols(db, table);
  const candidates = [
    ["agreement_id", ids.agreements], ["sale_agreement_id", ids.agreements], ["installment_agreement_id", ids.agreements],
    ["application_id", ids.applications], ["credit_application_id", ids.applications],
    ["payment_id", ids.payments], ["sale_payment_id", ids.payments],
  ];
  for (const [column, values] of candidates) {
    if (c.has(column) && values.length) { await deleteBy(db, table, column, values, deleted); return; }
  }
  if (INSTALLMENT_TABLES.includes(table)) {
    const [r] = await db.query(`DELETE FROM \`${table}\``);
    if (r.affectedRows) deleted.push({ table, rows: Number(r.affectedRows), scope: "dedicated_installment_table" });
  }
}

async function referenced(db, table, id) {
  const [refs] = await db.query("SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME=? AND REFERENCED_COLUMN_NAME='id' AND TABLE_NAME<>?", [table, table]);
  for (const ref of refs) {
    if (!(await exists(db, ref.TABLE_NAME))) continue;
    const c = await cols(db, ref.TABLE_NAME);
    if (!c.has(ref.COLUMN_NAME)) continue;
    const [[r]] = await db.query(`SELECT COUNT(*) count FROM \`${ref.TABLE_NAME}\` WHERE \`${ref.COLUMN_NAME}\`=?`, [id]);
    if (Number(r?.count || 0)) return true;
  }
  return false;
}

async function removeOrphanMasters(db, ids, deleted) {
  // Only delete master records that were identified from Installment data and are now
  // completely unreferenced. Hiring/Mining/Spare Parts references therefore protect them.
  for (const table of MASTER_TABLES) {
    if (!(await exists(db, table))) continue;
    for (const id of [...ids.customers, ...ids.assets]) {
      if (!(await referenced(db, table, id))) await deleteBy(db, table, "id", [id], deleted);
    }
  }
}

async function clearEverythingInInstallment(db, deleted = []) {
  const ids = await collect(db);
  const paymentIds = ids.payments;
  if (ids.agreements.length && await exists(db, "equipment_sale_payments")) {
    const [rows] = await db.query(`SELECT id FROM equipment_sale_payments WHERE agreement_id IN (${ph(ids.agreements)})`, ids.agreements);
    ids.payments = uniq([...paymentIds, ...rows.map(r => r.id)]);
  }
  await deleteBy(db, "equipment_sale_payment_allocations", "payment_id", ids.payments, deleted);
  for (const table of INSTALLMENT_TABLES) await deleteScoped(db, table, ids, deleted);
  await deleteBy(db, "equipment_sale_agreements", "id", ids.agreements, deleted);
  await deleteBy(db, "equipment_credit_applications", "id", ids.applications, deleted);
  await deleteBy(db, "equipment_sales_quotation_items", "quotation_id", ids.quotations, deleted);
  await deleteBy(db, "equipment_sales_quotations", "id", ids.quotations, deleted);
  await removeOrphanMasters(db, ids, deleted);
  return { ids, deleted };
}

async function clearEverythingInInstallmentTransaction(connection = null) {
  const owns = !connection;
  const db = connection || await pool.getConnection();
  try { await db.beginTransaction(); const result = await clearEverythingInInstallment(db); await db.commit(); return result; }
  catch (e) { try { await db.rollback(); } catch (_) {} throw e; }
  finally { if (owns) db.release(); }
}

module.exports = { clearEverythingInInstallment, clearEverythingInInstallmentTransaction };
