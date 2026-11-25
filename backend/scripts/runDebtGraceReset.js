"use strict";
const {pool}=require("../config/db");
const {applyGraceReset,MARKER}=require("../services/debtGracePeriodService");
async function main(){
 if(process.env.NODE_ENV!=="production"||process.env.CHALIN03_DEBT_GRACE_RESET!==MARKER)throw Error("Exact production grace reset authorization required");
 const expected=process.env.CHALIN03_EXPECTED_DATABASE;
 if(!expected)throw Error("Expected database identity required");
 const conn=await pool.getConnection();
 try{
  const [[identity]]=await conn.query("SELECT DATABASE() AS selected");
  if(identity.selected!==expected)throw Error("Production database identity mismatch");
  console.log("Debt grace reset verified:",JSON.stringify(await applyGraceReset(conn)));
 }finally{conn.release();await pool.end();}
}
if(require.main===module)main().catch(e=>{console.error("Debt grace reset failed:",e.message);process.exitCode=1;});
