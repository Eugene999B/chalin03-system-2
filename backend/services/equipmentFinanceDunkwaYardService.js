"use strict";
const {pool} = require("../config/db");
const YARD_CODE="DUNKWA-YARD";
const YARD_NAME="Dunkwa Yard";
function normalized(value){return String(value||"").trim().replace(/\s+/g," ").toLowerCase();}
function isDunkwaYard(location){
  const code=normalized(location?.code).replace(/_/g,"-");
  const name=normalized(location?.name);
  return code===YARD_CODE.toLowerCase()||
    ["dunkwa yard","dunkwa equipment yard","dunkwa-on-offin yard"].includes(name);
}
async function ensureDunkwaYard(connection=pool){
  // This is a company equipment yard, NEVER a Spare Parts branch or Mining site.
  const [units]=await connection.query(
    "SELECT id FROM business_units WHERE code='equipment_hire' AND is_enabled=TRUE LIMIT 1"
  );
  const unitId=Number(units[0]?.id||0);
  if(!unitId)return {status:"skipped",reason:"Equipment business unit is unavailable."};
  const [candidates]=await connection.query(
    "SELECT id,code,name,is_active FROM business_locations "+
    "WHERE business_unit_id=? AND ("+
    "code IN ('DUNKWA-YARD','DUNKWA_YARD') "+
    "OR LOWER(TRIM(name)) IN ('dunkwa yard','dunkwa equipment yard','dunkwa-on-offin yard')) "+
    "ORDER BY is_active DESC,id ASC",
    [unitId]
  );
  const existing=candidates.find(isDunkwaYard);
  if(existing){
    // The owner requested this yard to be available again. Re-enable only the
    // exact matched yard, never remap excavators or touch its address/history.
    if(!Number(existing.is_active)){
      await connection.query(
        "UPDATE business_locations SET is_active=TRUE WHERE id=? AND business_unit_id=?",
        [existing.id,unitId]
      );
      return {status:"reactivated",id:existing.id};
    }
    return {status:"existing",id:existing.id};
  }
  // Safe in concurrent replicas: unique (business_unit_id,code) handles a race
  // without renaming or replacing an existing yard.
  await connection.query(
    "INSERT INTO business_locations "+
    "(business_unit_id,code,name,location_type,address,is_active) "+
    "VALUES (?,?,?,'yard',?,TRUE) ON DUPLICATE KEY UPDATE id=id",
    [unitId,YARD_CODE,YARD_NAME,"Dunkwa-on-Offin, Ghana"]
  );
  const [created]=await connection.query(
    "SELECT id,code,name,is_active FROM business_locations "+
    "WHERE business_unit_id=? AND code=? LIMIT 1",
    [unitId,YARD_CODE]
  );
  return created.length?{status:"created",id:created[0].id}:
    {status:"skipped",reason:"Yard could not be verified after insertion."};
}
module.exports={ensureDunkwaYard,isDunkwaYard,YARD_CODE,YARD_NAME};
