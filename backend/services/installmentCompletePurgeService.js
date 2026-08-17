const { pool } = require("../config/db");
const placeholders = values => values.map(() => "?").join(",");

async function tableExists(db, table) { const [[r]] = await db.query("SELECT COUNT(*) count FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?", [table]); return Number(r?.count || 0) === 1; }
async function columns(db, table) { if (!(await tableExists(db, table))) return new Set(); const [rows] = await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?", [table]); return new Set(rows.map(r => String(r.COLUMN_NAME))); }
async function deleteIds(db, table, column, ids, deleted) { if (!ids.length || !(await tableExists(db, table))) return; const c=await columns(db,table); if(!c.has(column)) return; const [r]=await db.query(`DELETE FROM \`${table}\` WHERE \`${column}\` IN (${placeholders(ids)})`,ids); if(r.affectedRows) deleted.push({table,rows:Number(r.affectedRows)}); }

async function collectIds(db) {
  const out={agreementIds:new Set(),applicationIds:new Set(),quotationIds:new Set(),customerIds:new Set(),equipmentIds:new Set()};
  if(await tableExists(db,"equipment_sale_agreements")){
    const c=await columns(db,"equipment_sale_agreements");
    const f=["id","customer_id","customerId","asset_id","equipment_id","excavator_id","credit_application_id"].filter(x=>x==="id"||c.has(x));
    const w=c.has("sale_type")?" WHERE sale_type='installment'":"";
    const [rows]=await db.query(`SELECT ${f.join(",")} FROM equipment_sale_agreements${w}`);
    for(const r of rows){out.agreementIds.add(Number(r.id));for(const x of ["customer_id","customerId"])if(r[x]!=null)out.customerIds.add(Number(r[x]));for(const x of ["asset_id","equipment_id","excavator_id"])if(r[x]!=null)out.equipmentIds.add(Number(r[x]));if(r.credit_application_id!=null)out.applicationIds.add(Number(r.credit_application_id));}
  }
  if(out.applicationIds.size&&await tableExists(db,"equipment_credit_applications")){
    const c=await columns(db,"equipment_credit_applications"), ids=[...out.applicationIds];
    const f=["id","quotation_id","customer_id","customerId","asset_id","equipment_id","excavator_id"].filter(x=>x==="id"||c.has(x));
    const [rows]=await db.query(`SELECT ${f.join(",")} FROM equipment_credit_applications WHERE id IN (${placeholders(ids)})`,ids);
    for(const r of rows){for(const x of ["customer_id","customerId"])if(r[x]!=null)out.customerIds.add(Number(r[x]));for(const x of ["asset_id","equipment_id","excavator_id"])if(r[x]!=null)out.equipmentIds.add(Number(r[x]));if(r.quotation_id!=null)out.quotationIds.add(Number(r.quotation_id));}
  }
  for(const k of Object.keys(out))out[k]=[...out[k]].filter(Number.isInteger);
  return out;
}

async function deleteChildren(db,ids,deleted){
  const agreementTables=["equipment_finance_case_activity","equipment_finance_documents","equipment_finance_private_documents","equipment_finance_document_reviews","equipment_finance_delivery_authorizations","equipment_finance_delivery_confirmations","equipment_finance_correction_requests","equipment_finance_correction_ledger","equipment_installment_schedule","equipment_sale_payment_allocations","equipment_sale_payments","equipment_deliveries","equipment_ownership_transfers","equipment_asset_sale_locks"];
  const appTables=["equipment_credit_application_kyc","equipment_credit_application_reviews","equipment_credit_application_affordability","equipment_credit_application_guarantors","equipment_credit_application_consents"];
  if(await tableExists(db,"equipment_sale_payments")&&ids.agreementIds.length){const [rows]=await db.query(`SELECT id FROM equipment_sale_payments WHERE agreement_id IN (${placeholders(ids.agreementIds)})`,ids.agreementIds);ids.paymentIds=rows.map(r=>Number(r.id)).filter(Number.isInteger);}
  for(const t of agreementTables){const c=await columns(db,t);for(const [col,v] of [["agreement_id",ids.agreementIds],["sale_agreement_id",ids.agreementIds],["installment_agreement_id",ids.agreementIds],["application_id",ids.applicationIds],["credit_application_id",ids.applicationIds],["payment_id",ids.paymentIds||[]],["sale_payment_id",ids.paymentIds||[]]])if(c.has(col)&&v.length){await deleteIds(db,t,col,v,deleted);break;}}
  for(const t of appTables){const c=await columns(db,t);for(const col of ["application_id","credit_application_id"])if(c.has(col)&&ids.applicationIds.length){await deleteIds(db,t,col,ids.applicationIds,deleted);break;}}
  await deleteIds(db,"equipment_sale_agreements","id",ids.agreementIds,deleted); await deleteIds(db,"equipment_credit_applications","id",ids.applicationIds,deleted);
  await deleteIds(db,"equipment_sales_quotation_items","quotation_id",ids.quotationIds,deleted); await deleteIds(db,"equipment_sales_quotations","id",ids.quotationIds,deleted);
}

async function isReferenced(db,table,id){
  const [refs]=await db.query("SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME=? AND REFERENCED_COLUMN_NAME='id' AND TABLE_NAME<>?",[table,table]);
  for(const ref of refs){if(!(await tableExists(db,ref.TABLE_NAME)))continue;const c=await columns(db,ref.TABLE_NAME);if(!c.has(ref.COLUMN_NAME))continue;const [[r]]=await db.query(`SELECT COUNT(*) count FROM \`${ref.TABLE_NAME}\` WHERE \`${ref.COLUMN_NAME}\`=?`,[id]);if(Number(r?.count||0)>0)return true;}return false;
}

async function purgeParents(db,ids,deleted){
  // Explicit master tables first; aliases cover the schema variants used by the equipment module.
  const customerTables=["customers","equipment_customers","equipment_customer_profiles","customer_profiles"];
  const equipmentTables=["excavators","equipment_excavators","equipment","equipment_assets","fleet_assets"];
  for(const table of customerTables){if(!(await tableExists(db,table)))continue;for(const id of ids.customerIds){if(!(await isReferenced(db,table,id)))await deleteIds(db,table,"id",[id],deleted);}}
  for(const table of equipmentTables){if(!(await tableExists(db,table)))continue;for(const id of ids.equipmentIds){if(!(await isReferenced(db,table,id)))await deleteIds(db,table,"id",[id],deleted);}}
}

async function clearEverythingInInstallment(db,deleted=[]){const ids=await collectIds(db);await deleteChildren(db,ids,deleted);await purgeParents(db,ids,deleted);return{ids,deleted};}
async function clearEverythingInInstallmentTransaction(connection=null){const owns=!connection;const db=connection||await pool.getConnection();try{await db.beginTransaction();const r=await clearEverythingInInstallment(db);await db.commit();return r;}catch(e){try{await db.rollback();}catch(_){}throw e;}finally{if(owns)db.release();}}
module.exports={clearEverythingInInstallment,clearEverythingInInstallmentTransaction};
