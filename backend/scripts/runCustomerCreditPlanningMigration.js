"use strict";
// Explicit, additive release migration; never imported by server startup.
// Railway builds only /backend, so SQL is packaged byte-for-byte from the canonical migration directory.
const fs=require("node:fs");
const path=require("node:path");
const {executeSqlScript}=require("./sqlScriptRunner");
const NAMES=Object.freeze(["20261125_customer_credit_foundation","20261125_customer_credit_approval_queue","20261125_sale_item_ownership_evidence","20261125_management_planning_settings"]);
const RELEASE="20261125_CUSTOMER_CREDIT_PLANNING";
const LOCK="chalin03:customer-credit-planning:20261125";
const TABLES=["customer_credit_profiles","customer_credit_settings","customer_credit_score_events","customer_credit_approval_requests","sale_item_ownership_classifications","sale_item_ownership_events","management_planning_settings"];
const ZERO_KEYS=new Set(["missing_customer_profiles","missing_branch_settings","invalid_scores","invalid_terms","invalid_approval_records","invalid_classifications","invalid_settings"]);
function assertAuthorization(env=process.env,now=Date.now()){
 if(env.NODE_ENV!=="production"||env.CHALIN03_CREDIT_MIGRATION_ENABLED!=="true"||env.CHALIN03_CREDIT_MIGRATION_RELEASE!==RELEASE)throw Error("Exact controlled production release authorization is required.");
 if(env.CHALIN03_SQL_BACKUP_CONFIRMED!=="true"||env.CHALIN03_CREDIT_BACKUP_RESTORE_VERIFIED!=="true")throw Error("Fresh SQL backup and separate verified restore are required.");
 const created=Date.parse(env.MIGRATION_BACKUP_CREATED_AT||"");
 if(!Number.isFinite(created)||created>now||now-created>24*60*60*1000||!/^([a-f0-9]{64})$/i.test(env.MIGRATION_BACKUP_SHA256||"")||!env.MIGRATION_BACKUP_REFERENCE||!env.MIGRATION_APPROVED_BY||!env.MIGRATION_CHANGE_TICKET||!env.CHALIN03_EXPECTED_DATABASE)throw Error("Fresh backup manifest, database identity and release approval evidence required.");
}
function packaged(name){return fs.readFileSync(path.resolve(__dirname,"../migrations",name),"utf8");}
async function applyAndVerify(connection){
 let held=false;
 try{
  const [[lock]]=await connection.query("SELECT GET_LOCK(?,30) AS acquired",[LOCK]);held=Number(lock?.acquired)===1;
  if(!held)throw Error("Could not obtain credit migration lock");
  for(const name of NAMES){
    await executeSqlScript(connection,packaged(name+".sql"),name);
    const rows=(await executeSqlScript(connection,packaged(name+"_verify.sql"),name+" verification")).flat();
    if(!rows.some(row=>row.migration_name===name))throw Error("Missing migration marker: "+name);
    for(const row of rows)for(const key of Object.keys(row))if(ZERO_KEYS.has(key)&&Number(row[key])!==0)throw Error("Verification failed: "+key);
    if(name==="20261125_management_planning_settings"&&!rows.some(row=>Number(row.id)===1&&Number(row.assumed_partner_percent)>=0&&Number(row.assumed_partner_percent)<=100&&Number(row.version)>=1))throw Error("Planning settings missing or invalid");
  }
  const [actual]=await connection.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ("+TABLES.map(()=>"?").join(",")+")",TABLES);
  if(new Set(actual.map(x=>x.TABLE_NAME)).size!==TABLES.length)throw Error("Missing release tables");
  return {verified:true,migrations:NAMES.length,tables:TABLES.length};
 }finally{if(held)await connection.query("SELECT RELEASE_LOCK(?)",[LOCK]);}
}
async function run(){
 require("dotenv").config();
 assertAuthorization();
 const mysql=require("mysql2/promise");
 const env=process.env,required=(a,b)=>{const v=env[a]||env[b];if(!v)throw Error("Missing database variable "+a);return v;};
 const database=required("DB_NAME","MYSQLDATABASE");
 if(database!==env.CHALIN03_EXPECTED_DATABASE)throw Error("Database identity mismatch");
 const ssl=env.DB_SSL==="true"?env.DB_SSL_CA_BASE64?{ca:Buffer.from(env.DB_SSL_CA_BASE64,"base64").toString("utf8"),rejectUnauthorized:true}:{rejectUnauthorized:!["0","false","off","no"].includes(String(env.DB_SSL_REJECT_UNAUTHORIZED||"true").toLowerCase())}:undefined;
 const conn=await mysql.createConnection({host:required("DB_HOST","MYSQLHOST"),port:Number(env.DB_PORT||env.MYSQLPORT||3306),user:required("DB_USER","MYSQLUSER"),password:required("DB_PASSWORD","MYSQLPASSWORD"),database,ssl,timezone:"Z",multipleStatements:false,connectTimeout:15000});
 try{
  const [[row]]=await conn.query("SELECT DATABASE() AS selected");
  if(row.selected!==env.CHALIN03_EXPECTED_DATABASE)throw Error("Selected database identity mismatch");
  console.log("Credit and planning migration verified:",JSON.stringify(await applyAndVerify(conn)));
 }finally{await conn.end();}
}
if(require.main===module)run().catch(e=>{console.error("Credit and planning migration failed:",e.message);process.exitCode=1;});
module.exports={NAMES,RELEASE,assertAuthorization,applyAndVerify};
