"use strict";

// One-time, reviewed, pre-deploy ONLY DDL. Do not import this from server.js.
// Correct a legacy Hire trigger which mistakenly rejects company-wide Ready
// Cash agreements (hire_location_id=NULL) when the physical machine has a yard.
const mysql=require("mysql2/promise");
require("dotenv").config();

const MIGRATION="20261119_ready_cash_company_wide_sale_guard";
const LOCK="chalin03:ready-cash:company-wide-sale-guard-20261119";
const MARKER="(fa.hire_location_id IS NULL OR fa.hire_location_id = NEW.hire_location_id)";
const CORRECTED="(fa.hire_location_id IS NULL OR fa.hire_location_id = NEW.hire_location_id OR (NEW.hire_location_id IS NULL AND NEW.sale_type = 'cash' AND NEW.agreement_notes LIKE 'READY_CASH:%'))";
const TRIGGERS=Object.freeze([
 {name:"trg_equipment_sale_agreement_hire_guard_before_insert",event:"INSERT",shadow:"trg_ready_cash_guard_migration_insert"},
 {name:"trg_equipment_sale_agreement_hire_guard_before_update",event:"UPDATE",shadow:"trg_ready_cash_guard_migration_update"}
]);
function correctedBody(action){
 const source=String(action||"");
 if(!source.includes("FROM hire_contract_assets")||
   !source.includes("sale_allowed_count")||
   !source.includes("SIGNAL SQLSTATE")||
   !source.includes("fa.operational_purpose IN ('sale_only','sale_or_hire')")){
  throw Error("Legacy asset-sale guard differs from the reviewed contract; no automatic replacement is safe.");
 }
 if(source.includes(CORRECTED))return source;
 if(!source.includes(MARKER))throw Error("Unexpected location guard; no automatic replacement is safe.");
 return source.replace(MARKER,CORRECTED);
}
function config(){
 const env=(a,b)=>{const v=process.env[a]||process.env[b];if(!v)throw Error("Missing required database variable "+a);return v;};
 const ca=String(process.env.DB_SSL_CA_BASE64||"");
 const ssl=String(process.env.DB_SSL||"").toLowerCase()==="true"?
    ca?{ca:Buffer.from(ca,"base64").toString("utf8"),rejectUnauthorized:true}
    :{rejectUnauthorized:!["false","0","off","no"].includes(String(process.env.DB_SSL_REJECT_UNAUTHORIZED||"true").toLowerCase())}:undefined;
 return {host:env("DB_HOST","MYSQLHOST"),port:Number(process.env.DB_PORT||process.env.MYSQLPORT||3306),
  user:env("DB_USER","MYSQLUSER"),password:env("DB_PASSWORD","MYSQLPASSWORD"),
  database:env("DB_NAME","MYSQLDATABASE"),ssl,connectTimeout:15000,timezone:"Z"};
}
async function readTriggers(connection){
 const names=TRIGGERS.flatMap(t=>[t.name,t.shadow]);
 const [rows]=await connection.query(
  "SELECT TRIGGER_NAME,EVENT_MANIPULATION,ACTION_TIMING,ACTION_STATEMENT "+
  "FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() "+
  "AND EVENT_OBJECT_TABLE='equipment_sale_agreements' "+
  "AND TRIGGER_NAME IN (?,?,?,?)",names);
 return new Map(rows.map(row=>[row.TRIGGER_NAME,row]));
}
async function applyTrigger(connection,definition){
 let current=await readTriggers(connection);
 const live=current.get(definition.name);
 const shadow=current.get(definition.shadow);
 let body;
 if(live){
  if(live.EVENT_MANIPULATION!==definition.event||live.ACTION_TIMING!=="BEFORE")
    throw Error("Unexpected timing/event for "+definition.name);
  body=correctedBody(live.ACTION_STATEMENT);
 }else if(shadow){
  // Recovery after interruption between DROP and CREATE: the shadow keeps
  // the full sale guard effective and can reconstruct the canonical trigger.
  body=correctedBody(shadow.ACTION_STATEMENT);
 }else throw Error("Sale guard missing with no continuity guard: "+definition.name);
 if(live && String(live.ACTION_STATEMENT).includes(CORRECTED)){
  if(shadow)await connection.query("DROP TRIGGER \`"+definition.shadow+"\`");
  return "already-correct";
 }
 if(!shadow){
  await connection.query("CREATE TRIGGER \`"+definition.shadow+"\` BEFORE "+
    definition.event+" ON equipment_sale_agreements FOR EACH ROW "+body);
 }
 if(live){
  await connection.query("DROP TRIGGER \`"+definition.name+"\`");
 }
 try{
  await connection.query("CREATE TRIGGER \`"+definition.name+"\` BEFORE "+
    definition.event+" ON equipment_sale_agreements FOR EACH ROW "+body);
 }catch(error){
  // Retain the shadow so Hire, Finance and sales remain guarded on failure.
  console.error("Canonical sale-guard replacement failed; protective shadow remains:",definition.name);
  throw error;
 }
 // Both guards are now active. Remove the temporary copy only after success.
 await connection.query("DROP TRIGGER \`"+definition.shadow+"\`");
 return "corrected";
}
async function main(){
 if(process.env.NODE_ENV!=="production")throw Error("This approved repair is production-only.");
 const connection=await mysql.createConnection(config());
 let held=false;
 try{
  const [[identity]]=await connection.query("SELECT DATABASE() AS selected");
  const expected=String(process.env.CHALIN03_EXPECTED_DATABASE||process.env.DB_NAME||process.env.MYSQLDATABASE||"");
  if(!identity?.selected||identity.selected!==expected)throw Error("Production database identity mismatch.");
  const [[lock]]=await connection.query("SELECT GET_LOCK(?,30) AS acquired",[LOCK]);
  held=Number(lock?.acquired)===1;
  if(!held)throw Error("Could not obtain migration safety lock.");
  const current=await readTriggers(connection);
  const alreadyVerified=TRIGGERS.every(t=>
    current.get(t.name)?.ACTION_STATEMENT?.includes(CORRECTED) &&
    !current.has(t.shadow));
  if(!alreadyVerified){
    const backup=String(process.env.CHALIN03_SIGNED_BACKUP_CONFIRMED||"").toLowerCase();
    if(!["true","1","yes"].includes(backup)||
      !/^[a-fA-F0-9]{64}$/.test(String(process.env.MIGRATION_BACKUP_SHA256||"").trim())){
      throw Error("Signed production backup confirmation and SHA-256 required before changing sale guards.");
    }
  }
  const result=[];
  for(const definition of TRIGGERS)result.push({name:definition.name,action:await applyTrigger(connection,definition)});
  const actual=await readTriggers(connection);
  for(const t of TRIGGERS){
   if(!actual.get(t.name)?.ACTION_STATEMENT?.includes(CORRECTED)||actual.has(t.shadow))
     throw Error("Sale-guard verification failed for "+t.name);
  }
  await connection.query(
   "INSERT INTO schema_migrations (migration_name,description) VALUES (?,?) "+
   "ON DUPLICATE KEY UPDATE description=VALUES(description)",
   [MIGRATION,"Only explicit company-wide Ready Cash cash sales can pass the legacy physical-yard comparison; existing active-Hire and unavailable-asset guards unchanged."]
  );
  console.log("Ready Cash company-wide physical-yard sale guards verified",JSON.stringify(result));
 }finally{
  if(held)await connection.query("SELECT RELEASE_LOCK(?)",[LOCK]).catch(()=>{});
  await connection.end();
 }
}
if(require.main===module){
 main().catch(error=>{console.error("Ready Cash approved physical-yard guard repair failed:",error.message);process.exitCode=1;});
}
module.exports={correctedBody,TRIGGERS,CORRECTED,MARKER,applyTrigger};
