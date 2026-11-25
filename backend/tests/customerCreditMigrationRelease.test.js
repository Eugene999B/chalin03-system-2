const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {NAMES,RELEASE,assertAuthorization}=require("../scripts/runCustomerCreditPlanningMigration");
test("packaged migration and verifier SQL exactly match canonical files",()=>{
 for(const name of NAMES)for(const suffix of [".sql","_verify.sql"]){
  const file=name+suffix;
  assert.equal(fs.readFileSync(path.resolve(__dirname,"../migrations",file),"utf8"),fs.readFileSync(path.resolve(__dirname,"../../database/migrations",file),"utf8"));
 }
});
test("production migration refuses absent, stale or unverified backup evidence",()=>{
 const now=Date.parse("2026-11-25T21:30:00Z");
 const env={NODE_ENV:"production",CHALIN03_CREDIT_MIGRATION_ENABLED:"true",CHALIN03_CREDIT_MIGRATION_RELEASE:RELEASE,CHALIN03_SQL_BACKUP_CONFIRMED:"true",CHALIN03_CREDIT_BACKUP_RESTORE_VERIFIED:"true",MIGRATION_BACKUP_CREATED_AT:"2026-11-25T21:20:00Z",MIGRATION_BACKUP_SHA256:"a".repeat(64),MIGRATION_BACKUP_REFERENCE:"fixture-only",MIGRATION_APPROVED_BY:"fixture-reviewer",MIGRATION_CHANGE_TICKET:"fixture-ticket",CHALIN03_EXPECTED_DATABASE:"fixture"};
 assert.doesNotThrow(()=>assertAuthorization(env,now));
 assert.throws(()=>assertAuthorization({...env,CHALIN03_CREDIT_BACKUP_RESTORE_VERIFIED:"false"},now));
 assert.throws(()=>assertAuthorization({...env,MIGRATION_BACKUP_CREATED_AT:"2026-11-23T00:00:00Z"},now));
 assert.throws(()=>assertAuthorization({...env,CHALIN03_EXPECTED_DATABASE:""},now));
 assert.throws(()=>assertAuthorization({},now));
});
