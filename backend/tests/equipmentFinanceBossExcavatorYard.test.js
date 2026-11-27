"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {
  buildOwnershipSummary,bossMachineOwnership,uniqueAssetIds
}=require("../services/equipmentFinanceBossMachineOwnershipService");
const {ensureDunkwaYard,isDunkwaYard}=require("../services/equipmentFinanceDunkwaYardService");

test("boss excavator trail distinguishes buyer, applicant, paid, and prior buyer without guessing",()=>{
  const assets=[
    {id:1,asset_code:"EX-1",supplier_name:"Reliable Supplies",sale_status:"reserved",location_name:"Dunkwa Yard",hire_location_id:8},
    {id:2,asset_code:"EX-2",sale_status:"available",location_name:"Dunkwa Yard"},
    {id:3,asset_code:"EX-3",sale_status:"sold"},
    {id:4,asset_code:"EX-4",sale_status:"available"},
    {id:5,asset_code:"EX-5",sale_status:"available"},
  ];
  const agreements=[
    {id:9,asset_id:1,customer_id:2,customer_name_snapshot:"Ama Adom",customer_phone_snapshot:"0241111111",agreement_number:"FIN-9",agreement_status:"active",sale_type:"installment",outstanding_balance:7000,amount_paid:3000,sale_price:10000},
    {id:8,asset_id:1,customer_name_snapshot:"Old draft",agreement_status:"draft",sale_type:"installment"},
    {id:12,asset_id:3,customer_name_snapshot:"Kwame Customer",agreement_number:"SALE-12",agreement_status:"completed",sale_type:"cash"},
    {id:13,asset_id:4,customer_name_snapshot:"Earlier buyer",agreement_number:"SALE-13",agreement_status:"completed",sale_type:"installment"},
    {id:14,asset_id:5,customer_name_snapshot:"Cancelled agreement",agreement_status:"cancelled",sale_type:"installment"},
  ];
  const apps=[
    {id:21,asset_id:2,application_number:"APP-21",application_status:"submitted",customer_id:5,customer_name:"Kojo Applicant",customer_phone:"0203333333"},
    {id:22,asset_id:3,application_number:"APP-22",application_status:"withdrawn",customer_name:"Withdrawn"},
  ];
  const rows=buildOwnershipSummary(assets,agreements,apps);
  assert.equal(rows[0].stage,"on_installment");
  assert.equal(rows[0].customer_name,"Ama Adom");
  assert.equal(rows[0].outstanding_balance,7000);
  assert.equal(rows[0].supplier_name,"Reliable Supplies");
  assert.equal(rows[0].physical_yard_name,"Dunkwa Yard");
  assert.equal(rows[1].stage,"application_pending");
  assert.equal(rows[1].customer_name,"Kojo Applicant");
  assert.equal(rows[1].agreement_id,null);
  assert.equal(rows[2].stage,"sold");
  assert.equal(rows[2].customer_name,"Kwame Customer");
  assert.equal(rows[3].stage,"previous_sale");
  assert.equal(rows[4].stage,"no_customer");
  assert.equal(rows[4].supplier_name,null);
});

test("boss-only database lookup rejects ordinary staff and does not query customer records",async()=>{
 let queries=0;
 const db={query:async()=>{queries++;return [[]]}};
 await assert.rejects(
  ()=>bossMachineOwnership({user:{id:18,username:"cashier",role:"cashier"},assetIds:[1],connection:db}),
  error=>error.statusCode===403 && error.code==="BOSS_MACHINE_OWNERSHIP_RESTRICTED"
 );
 assert.equal(queries,0);
 assert.deepEqual(uniqueAssetIds([1,"2",2,-1,"oops",0]),[1,2]);
});

test("verified original system admin reads owner evidence in three bounded queries",async()=>{
 const sql=[];
 const db={query:async(s,params)=>{
   sql.push({s,params});
   if(s.includes("FROM fleet_assets asset"))return [[{id:2,asset_code:"X-2",supplier_name:"Genuine Supply",sale_status:"available"}]];
   if(s.includes("FROM equipment_sale_agreements"))return [[]];
   if(s.includes("FROM equipment_credit_applications"))return [[{
     id:15,asset_id:2,customer_id:22,customer_name:"App Customer",
     application_number:"APP-15",application_status:"approved"
   }]];
   throw Error("Unexpected SQL");
 }};
 const rows=await bossMachineOwnership({user:{id:1,role:"admin",username:"admin"},assetIds:[2],connection:db});
 assert.equal(rows.length,1);
 assert.equal(rows[0].stage,"application_pending");
 assert.equal(sql.length,3);
 assert.ok(sql.every(entry=>Array.isArray(entry.params)));
});

test("Dunkwa yard detection recognises exact aliases but no unrelated offices",()=>{
 assert.equal(isDunkwaYard({code:"DUNKWA-YARD"}),true);
 assert.equal(isDunkwaYard({code:"DUNKWA_YARD"}),true);
 assert.equal(isDunkwaYard({name:"Dunkwa Equipment Yard"}),true);
 assert.equal(isDunkwaYard({name:"Dunkwa Equipment Office"}),false);
 assert.equal(isDunkwaYard({name:"Obuasi Yard"}),false);
});

test("Dunkwa yard seed creates only within enabled Hire unit and is idempotent",async()=>{
 let insertCount=0,exist=false;
 const sql=[];
 const db={query:async(query,params)=>{
  sql.push({query,params});
  if(query.includes("FROM business_units"))return [[{id:6}]];
  if(query.includes("FROM business_locations")&&query.includes("ORDER BY"))return [[exist?[{id:55,code:"DUNKWA-YARD",name:"Dunkwa Yard",is_active:1}]:[]].flat()];
  if(query.startsWith("INSERT INTO business_locations")){insertCount++;exist=true;return [{affectedRows:1}]}
  if(query.includes("AND code=? LIMIT 1"))return [[{id:55,code:"DUNKWA-YARD",name:"Dunkwa Yard",is_active:1}]];
  throw Error("Unexpected SQL");
 }};
 const first=await ensureDunkwaYard(db);
 assert.equal(first.status,"created");
 const second=await ensureDunkwaYard(db);
 assert.equal(second.status,"existing");
 assert.equal(insertCount,1);
 assert.equal(sql.find(x=>x.query.startsWith("INSERT")).params[0],6);
});

test("Dunkwa yard seed reactivates exact inactive yard without moving machines",async()=>{
 const queries=[];
 const db={query:async(query,params)=>{
  queries.push({query,params});
  if(query.includes("FROM business_units"))return [[{id:6}]];
  if(query.includes("ORDER BY"))return [[{id:12,code:"DUNKWA_YARD",name:"Dunkwa Yard",is_active:0}]];
  if(query.startsWith("UPDATE business_locations"))return [{affectedRows:1}];
  throw Error("Unexpected SQL");
 }};
 const result=await ensureDunkwaYard(db);
 assert.equal(result.status,"reactivated");
 assert.equal(result.id,12);
 assert.equal(queries.filter(x=>x.query.startsWith("UPDATE")).length,1);
 assert.equal(queries.some(x=>/fleet_assets|equipment_sale_agreements/.test(x.query)),false);
});

test("startup is guarded and only Finance Hire locations are offered",()=>{
 const bootstrap=fs.readFileSync(path.join(__dirname,"../services/equipmentFinanceDunkwaYardBootstrap.js"),"utf8");
 const preload=fs.readFileSync(path.join(__dirname,"../services/exportWorkbookSafetyBootstrap.js"),"utf8");
 const machineRegister=fs.readFileSync(path.join(__dirname,"../services/equipmentFinanceMachineRegisterService.js"),"utf8");
 const api=fs.readFileSync(path.join(__dirname,"../routes/equipmentFinanceMachineRegisterRoutes.js"),"utf8");
 assert.match(preload,/require\("\.\/equipmentFinanceDunkwaYardBootstrap"\)/);
 assert.match(bootstrap,/testDatabaseConnection/);
 assert.match(machineRegister,/ensureDunkwaYard\(pool\)/);
 assert.match(machineRegister,/unit\.code = 'equipment_hire'/);
 assert.match(api,/boss-ownership/);
 assert.match(api,/requirePermission\("fleet\.assets\.view"\)/);
});
