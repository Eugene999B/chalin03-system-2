"use strict";
// Railway allows one preDeployCommand. Run two individually reviewed, signed-
// backup-gated migrations sequentially; fail closed if either exits nonzero.
const {spawnSync}=require("node:child_process");
const path=require("node:path");
const MIGRATIONS=Object.freeze([
 "runReadyCashCompanyWideSaleGuardMigration.js",
 "migratePublicCommerceSchema.js",
]);
function run(){
 const migrations=[...MIGRATIONS];
 if(process.env.CHALIN03_DEBT_GRACE_RESET==="20261125_debt_grace_reset_30_days")migrations.push("runDebtGraceReset.js");
 for(const filename of migrations){
  const full=path.resolve(__dirname,filename);
  console.log("Production predeploy: checking "+filename);
  const result=spawnSync(process.execPath,[full],{
    stdio:"inherit",env:process.env,timeout:120000,
  });
  if(result.error || result.status!==0){
   console.error("Production predeploy stopped before next step:",filename,
     result.error?.code||"exit "+result.status);
   process.exitCode=1;
   return false;
  }
 }
 console.log("CHALIN03 production predeploy complete: sale guard + website commerce.");
 return true;
}
if(require.main===module)run();
module.exports={MIGRATIONS,run};
