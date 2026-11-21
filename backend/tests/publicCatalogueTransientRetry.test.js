"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {readCatalogueWithTransientRetry,isTransientCatalogueConnectionFailure}=require("../services/publicCatalogueTransientRetry");

test("first catalogue read times out and the single retry succeeds",async()=>{
 let reads=0;let sleeps=0;let reason="";
 const out=await readCatalogueWithTransientRetry(async()=>{
  reads++;
  if(reads===1)throw Object.assign(new Error("MySQL unavailable"),{code:"ETIMEDOUT"});
  return [{id:11,price:75}];
 },{pause:async()=>{sleeps++;},onRetry:code=>{reason=code;}});
 assert.deepEqual(out,[{id:11,price:75}]);
 assert.equal(reads,2);
 assert.equal(sleeps,1);
 assert.equal(reason,"ETIMEDOUT");
});
test("database still unavailable does not trigger unbounded read retries",async()=>{
 let reads=0;
 await assert.rejects(()=>readCatalogueWithTransientRetry(async()=>{
  reads++;throw Object.assign(new Error("still offline"),{code:"ETIMEDOUT"});
 },{pause:async()=>{}}),{code:"ETIMEDOUT"});
 assert.equal(reads,2);
});
test("SQL error does not retry so schema and permission failures remain visible",async()=>{
 let reads=0;
 await assert.rejects(()=>readCatalogueWithTransientRetry(async()=>{
  reads++;throw Object.assign(new Error("missing table"),{code:"ER_NO_SUCH_TABLE"});
 },{pause:async()=>{}}),{code:"ER_NO_SUCH_TABLE"});
 assert.equal(reads,1);
});
test("one successful query is never duplicated",async()=>{
 let reads=0;
 const value=await readCatalogueWithTransientRetry(async()=>{reads++;return [459];});
 assert.deepEqual(value,[459]);assert.equal(reads,1);
});
test("only known connection errors are eligible",()=>{
 assert.equal(isTransientCatalogueConnectionFailure({code:"ECONNRESET"}),true);
 assert.equal(isTransientCatalogueConnectionFailure({code:"PROTOCOL_CONNECTION_LOST"}),true);
 assert.equal(isTransientCatalogueConnectionFailure({code:"ER_DUP_ENTRY"}),false);
 assert.equal(isTransientCatalogueConnectionFailure(undefined),false);
});
