"use strict";
const assert=require("node:assert/strict");
const test=require("node:test");
const fs=require("node:fs");
const path=require("node:path");
const {correctedBody,MARKER,CORRECTED,TRIGGERS,applyTrigger}=
  require("../scripts/runReadyCashCompanyWideSaleGuardMigration");

const legacyBody=[
 "BEGIN",
 " DECLARE active_hire_count INT DEFAULT 0;",
 " DECLARE sale_allowed_count INT DEFAULT 0;",
 " SELECT COUNT(*) INTO active_hire_count FROM hire_contract_assets hca",
 " WHERE hca.asset_id=NEW.asset_id AND hca.status IN ('assigned','dispatched','active');",
 " SELECT COUNT(*) INTO sale_allowed_count FROM fleet_assets fa",
 " WHERE fa.id=NEW.asset_id AND fa.is_active=TRUE",
 " AND fa.operational_purpose IN ('sale_only','sale_or_hire')",
 " AND fa.sale_status NOT IN ('sold','cancelled')",
 " AND "+MARKER+";",
 " IF active_hire_count>0 THEN",
 "  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Active Hire cannot be sold.';",
 " END IF;",
 " IF sale_allowed_count=0 THEN",
 "  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Not available for sale at this Hire location.';",
 " END IF;",
 "END"
].join("\n");

test("company-wide Ready Cash recognizes a physical yard without weakening Hire controls",()=>{
 const patch=correctedBody(legacyBody);
 assert.match(patch,/NEW\.hire_location_id IS NULL AND NEW\.sale_type = 'cash'/);
 assert.match(patch,/NEW\.agreement_notes LIKE 'READY_CASH:%'/);
 assert.match(patch,/fa\.hire_location_id = NEW\.hire_location_id/);
 assert.match(patch,/hca\.status IN \('assigned','dispatched','active'\)/);
 assert.match(patch,/fa\.sale_status NOT IN \('sold','cancelled'\)/);
 assert.equal(patch.split("FROM hire_contract_assets").length,2);
 assert.equal(correctedBody(patch),patch);
 assert.throws(()=>correctedBody("BEGIN SIGNAL SQLSTATE '45000'; END"),/differs from the reviewed contract/);
});

function fakeConnection({failCanonical=false}={}){
 const triggers=new Map(TRIGGERS.map(t=>[t.name,{
   TRIGGER_NAME:t.name,EVENT_MANIPULATION:t.event,
   ACTION_TIMING:"BEFORE",ACTION_STATEMENT:legacyBody
 }]));
 const operations=[];
 return {
  triggers,operations,
  query:async(sql)=>{
   operations.push(sql);
   if(sql.startsWith("SELECT TRIGGER_NAME"))return [[...triggers.values()]];
   const create=sql.match(/^CREATE TRIGGER \x60([^\x60]+)\x60 BEFORE (INSERT|UPDATE) ON /);
   if(create){
     if(failCanonical && create[1]===TRIGGERS[0].name)
       throw Error("Simulated CREATE TRIGGER failure");
     triggers.set(create[1],{TRIGGER_NAME:create[1],
       EVENT_MANIPULATION:create[2],ACTION_TIMING:"BEFORE",
       ACTION_STATEMENT:sql.slice(sql.indexOf("FOR EACH ROW ")+13)});
     return [{}];
   }
   const drop=sql.match(/^DROP TRIGGER \x60([^\x60]+)\x60$/);
   if(drop){triggers.delete(drop[1]);return [{}];}
   throw Error("Unexpected mock SQL "+sql);
  }
 };
}
test("migration creates a safety shadow before replacing and verifies canonical trigger",async()=>{
 const conn=fakeConnection();
 const result=await applyTrigger(conn,TRIGGERS[0]);
 assert.equal(result,"corrected");
 const original=conn.triggers.get(TRIGGERS[0].name);
 assert.ok(original?.ACTION_STATEMENT?.includes(CORRECTED));
 assert.equal(conn.triggers.has(TRIGGERS[0].shadow),false);
 const created=conn.operations.findIndex(x=>x.includes("CREATE TRIGGER \x60"+TRIGGERS[0].shadow+"\x60"));
 const dropped=conn.operations.findIndex(x=>x==="DROP TRIGGER \x60"+TRIGGERS[0].name+"\x60");
 assert.ok(created>=0 && dropped>created);
 assert.equal(await applyTrigger(conn,TRIGGERS[0]),"already-correct");
});

test("DDL failure retains protective shadow, never leaving unguarded Hire asset sales",async()=>{
 const conn=fakeConnection({failCanonical:true});
 await assert.rejects(()=>applyTrigger(conn,TRIGGERS[0]),/Simulated CREATE TRIGGER failure/);
 assert.equal(conn.triggers.has(TRIGGERS[0].name),false);
 assert.equal(conn.triggers.has(TRIGGERS[0].shadow),true);
 assert.ok(conn.triggers.get(TRIGGERS[0].shadow).ACTION_STATEMENT.includes(CORRECTED));
});

test("hotfix is pre-deploy DDL only, not request-time mutation",()=>{
 const root=path.resolve(__dirname,"../..");
 const railway=JSON.parse(fs.readFileSync(path.join(root,"railway.json"),"utf8"));
 const server=fs.readFileSync(path.join(root,"backend/server.js"),"utf8");
 const route=fs.readFileSync(path.join(root,"backend/routes/equipmentFinanceReadyCashRoutes.js"),"utf8");
 const migration=fs.readFileSync(path.join(root,"backend/scripts/runReadyCashCompanyWideSaleGuardMigration.js"),"utf8");
 assert.deepEqual(railway.deploy.preDeployCommand,["node scripts/runReadyCashCompanyWideSaleGuardMigration.js",
    "node scripts/migratePublicCommerceSchema.js"]);
 assert.match(migration,/CHALIN03_SIGNED_BACKUP_CONFIRMED/);
 assert.match(migration,/GET_LOCK/);
 assert.match(migration,/MIGRATION_BACKUP_SHA256/);
 assert.match(route,/READY_CASH_PHYSICAL_YARD_GUARD/);
 assert.match(route,/trigger_reason: error\.code === "ER_SIGNAL_EXCEPTION"/);
 assert.doesNotMatch(server,/runReadyCashCompanyWideSaleGuardMigration/);
});
