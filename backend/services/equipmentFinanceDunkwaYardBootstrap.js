"use strict";
// After the already installed operational approval startup gate, seed the
// single requested company-wide physical yard once. Never create schema,
// alter Hire assignments or modify any excavator, installment or receipt.
const dbModule=require("../config/db");
const {ensureDunkwaYard}=require("./equipmentFinanceDunkwaYardService");
const FLAG=Symbol.for("chalin03.dunkwaEquipmentYardBootstrapInstalled");
if(!dbModule[FLAG]){
 const original=dbModule.testDatabaseConnection;
 let performed=false;
 dbModule.testDatabaseConnection=async function checkDunkwaYardAfterDatabase(...args){
   const result=await original(...args);
   if(!performed){
     try{
       const yard=await ensureDunkwaYard(dbModule.pool);
       performed=yard.status==="existing"||yard.status==="created"||yard.status==="reactivated";
       console.log("Dunkwa equipment-yard bootstrap:",yard.status);
     }catch(error){
       // The Finance and Spare Parts API must not go down over one yard seed.
       // GET /machine-register/locations safely retries the same idempotent seed.
       console.warn("Dunkwa yard initialization deferred:",error.message);
     }
   }
   return result;
 };
 Object.defineProperty(dbModule,FLAG,{value:true,configurable:false});
}
