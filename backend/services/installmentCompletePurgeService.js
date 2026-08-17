const { pool } = require("../config/db");

function placeholders(values) { return values.map(() => "?").join(","); }

async function tableExists(db, table) {
  const [[r]] = await db.query(`SELECT COUNT(*) count FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`, [table]);
  return Number(r?.count || 0) === 1;
}

async function columns(db, table) {
  const [rows] = await db.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`, [table]);
  return new Set(rows.map(r => String(r.COLUMN_NAME)));
}

async function deleteIds(db, table, column, ids, deleted) {
  if (!ids.length || !(await tableExists(db, table))) return;
  const cols = await columns(db, table);
  if (!cols.has(column)) return;
  const [r] = await db.query(`DELETE FROM \`${table}\` WHERE \`${column}\` IN (${placeholders(ids)})`, ids);
  if (r.affectedRows) deleted.push({ table, rows: Number(r.affectedRows) });
}

async function collectInstallmentIds(db) {
  const customerIds = new Set();
  const equipmentIds = new Set();
  const agreementIds = new Set();
  const applicationIds = new Set();
  const quotationIds = new Set();

  const agreementTable = "equipment_sale_agreements";
  if (await tableExists(db, agreementTable)) {
    const cols = await columns(db, agreementTable);
    const select = ["id", ...["customer_id","customerId","asset_id","equipment_id","excavator_id","credit_application_id"].filter(c => cols.has(c))];
    const where = cols.has("sale_type") ? " WHERE sale_type='installment'" : "";
    const [rows] = await db.query(`SELECT ${select.join(",")} FROM \`${agreementTable}\`${where}`);
    for (const row of rows) {
      if (Number.isInteger(Number(row.id))) agreementIds.add(Number(row.id));
      for (const c of ["customer_id","customerId"]) if (row[c] != null) customerIds.add(Number(row[c]));
      for (const c of ["asset_id","equipment_id","excavator_id"]) if (row[c] != null) equipmentIds.add(Number(row[c]));
      if (row.credit_application_id != null) applicationIds.add(Number(row.credit_application_id));
    }
  }

  const appTable = "equipment_credit_applications";
  if (await tableExists(db, appTable)) {
    const cols = await columns(db, appTable);
    const select = ["id", ...["quotation_id","customer_id","customerId","asset_id","equipment_id","excavator_id"].filter(c => cols.has(c))];
    const where = applicationIds.size ? ` WHERE id IN (${placeholders([...applicationIds])})` : " WHERE 1=0";
    const [rows] = await db.query(`SELECT ${select.join(",")} FROM \`${appTable}\`${where}`, [...applicationIds]);
    for (const row of rows) {
      for (const c of ["customer_id","customerId"]) if (row[c] != null) customerIds.add(Number(row[c]));
      for (const c of ["asset_id","equipment_id","excavator_id"]) if (row[c] != null) equipmentIds.add(Number(row[c]));
      if (row.quotation_id != null) quotationIds.add(Number(row.quotation_id));
    }
  }

  return { agreementIds:[...agreementIds].filter(Number.isInteger), applicationIds:[...applicationIds].filter(Number.isInteger), quotationIds:[...quotationIds].filter(Number.isInteger), customerIds:[...customerIds].filter(Number.isInteger), equipmentIds:[...equipmentIds].filter(Number.isInteger) };
}

async function purgeUnreferencedParents(db, ids, deleted) {
  if (!ids.customerIds.length && !ids.equipmentIds.length) return;
  const [tables] = await db.query(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()`);
  const candidates = tables.map(r => String(r.TABLE_NAME)).filter(t => /customer|excavat|equipment|fleet/i.test(t) && !/finance|quotation|sale_agreement|credit_application/i.test(t));
  for (const table of candidates) {
    const cols = await columns(db, table);
    if (!cols.has("id")) continue;
    let targetIds = [];
    if (/customer/i.test(table)) targetIds = ids.customerIds;
    else if (/excavat|equipment|fleet/i.test(table)) targetIds = ids.equipmentIds;
    if (!targetIds.length) continue;
    const [rows] = await db.query(`SELECT id FROM \`${table}\` WHERE id IN (${placeholders(targetIds)})`, targetIds);
    const existing = rows.map(r => Number(r.id)).filter(Number.isInteger);
    if (!existing.length) continue;

    // Never delete a master row that is still referenced by another module (Hiring included).
    const [refs] = await db.query(`SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME=? AND REFERENCED_COLUMN_NAME='id' AND TABLE_NAME<>?`, [table, table]);
    let safe = [];
    for (const id of existing) {
      let referenced = false;
      for (const ref of refs) {
        const rc = await columns(db, ref.TABLE_NAME);
        if (!rc.has(ref.COLUMN_NAME)) continue;
        const [[r]] = await db.query(`SELECT COUNT(*) count FROM \`${ref.TABLE_NAME}\` WHERE \`${ref.COLUMN_NAME}\`=?`, [id]);
        if (Number(r?.count || 0)) { referenced = true; break; }
      }
      if (!referenced) safe.push(id);
    }
    await deleteIds(db, table, "id", safe, deleted);
  }
}

async function clearEverythingInInstallment(db, deleted = []) {
  const ids = await collectInstallmentIds(db);
  const agreementTables = ["equipment_finance_case_activity","equipment_finance_documents","equipment_finance_private_documents","equipment_finance_document_reviews","equipment_finance_delivery_authorizations","equipment_finance_delivery_confirmations","equipment_finance_correction_requests","equipment_finance_correction_ledger","equipment_installment_schedule","equipment_sale_payment_allocations","equipment_sale_payments","equipment_deliveries","equipment_ownership_transfers","equipment_asset_sale_locks"];
  const appTables = ["equipment_credit_application_kyc","equipment_credit_application_reviews","equipment_credit_application_affordability","equipment_credit_application_guarantors","equipment_credit_application_consents"];
  for (const t of agreementTables) { const c=await columns(db,t); for (const col of ["agreement_id","sale_agreement_id","installment_agreement_id"]) if(c.has(col)){await deleteIds(db,t,col,ids.agreementIds,deleted);break;} }
  for (const t of appTables) { const c=await columns(db,t); for (const col of ["application_id","credit_application_id"]) if(c.has(col)){await deleteIds(db,t,col,ids.applicationIds,deleted);break;} }
  await deleteIds(db,"equipment_sale_agreements","id",ids.agreementIds,deleted);
  await deleteIds(db,"equipment_credit_applications","id",ids.applicationIds,deleted);
  if (ids.quotationIds.length) { await deleteIds(db,"equipment_sales_quotation_items","quotation_id",ids.quotationIds,deleted); await deleteIds(db,"equipment_sales_quotations","id",ids.quotationIds,deleted); }
  await purgeUnreferencedParents(db,ids,deleted);
  return { ids, deleted };
}

async function clearEverythingInInstallmentTransaction(connection = null) {
  const owns = !connection;
  const db = connection || await pool.getConnection();
  try { await db.beginTransaction(); const result = await clearEverythingInInstallment(db); await db.commit(); return result; }
  catch(e){ try{await db.rollback();}catch(_){} throw e; }
  finally { if(owns) db.release(); }
}

module.exports = { clearEverythingInInstallment, clearEverythingInInstallmentTransaction };
