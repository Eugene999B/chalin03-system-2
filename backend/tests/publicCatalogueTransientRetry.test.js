"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {readCatalogueWithTransientRetry,isTransientCatalogueConnectionFailure,RECOVERY_DELAYS_MS}=require("../services/publicCatalogueTransientRetry");

test("first catalogue read times out and the first retry succeeds",async()=>{
 let reads=0;const waits=[];let reason="";
 const out=await readCatalogueWithTransientRetry(async()=>{
  reads++;
  if(reads===1)throw Object.assign(new Error("MySQL unavailable"),{code:"ETIMEDOUT"});
  return [{id:11,price:75}];
 },{pause:async ms=>{waits.push(ms);},onRetry:code=>{reason=code;}});
 assert.deepEqual(out,[{id:11,price:75}]);
 assert.equal(reads,2);
 assert.deepEqual(waits,[450]);
 assert.equal(reason,"ETIMEDOUT");
});
test("catalogue recovers after Railway MySQL sleep and several ECONNREFUSED attempts",async()=>{
 let reads=0;const waits=[];const logged=[];
 const result=await readCatalogueWithTransientRetry(async()=>{
  reads++;
  if(reads<4)throw Object.assign(new Error("database waking up"),{code:"ECONNREFUSED"});
  return [{id:11},{id:35}];
 },{pause:async ms=>{waits.push(ms);},onRetry:(code,attempt,ms)=>logged.push([code,attempt,ms])});
 assert.equal(reads,4);
 assert.deepEqual(result,[{id:11},{id:35}]);
 assert.deepEqual(waits,[450,900,1800]);
 assert.deepEqual(logged,[["ECONNREFUSED",1,450],["ECONNREFUSED",2,900],["ECONNREFUSED",3,1800]]);
});
test("database still unavailable stops at five SELECT attempts",async()=>{
 let reads=0;const waits=[];
 await assert.rejects(()=>readCatalogueWithTransientRetry(async()=>{
  reads++;throw Object.assign(new Error("still offline"),{code:"ETIMEDOUT"});
 },{pause:async ms=>waits.push(ms)}),{code:"ETIMEDOUT"});
 assert.equal(reads,RECOVERY_DELAYS_MS.length+1);
 assert.deepEqual(waits,[450,900,1800,3200]);
});
test("SQL error does not retry so schema and permission failures remain visible",async()=>{
 let reads=0;
 await assert.rejects(()=>readCatalogueWithTransientRetry(async()=>{
  reads++;throw Object.assign(new Error("missing table"),{code:"ER_NO_SUCH_TABLE"});
 },{pause:async()=>{}}),{code:"ER_NO_SUCH_TABLE"});
 assert.equal(reads,1);
});
test("a non-transient SQL failure after connection recovery must stop immediately",async()=>{
 let reads=0;
 await assert.rejects(()=>readCatalogueWithTransientRetry(async()=>{
  reads++;
  throw Object.assign(new Error("failure"),{code:reads===1?"ECONNREFUSED":"ER_BAD_FIELD_ERROR"});
 },{pause:async()=>{}}),{code:"ER_BAD_FIELD_ERROR"});
 assert.equal(reads,2);
});
test("one successful query is never duplicated",async()=>{
 let reads=0;
 const value=await readCatalogueWithTransientRetry(async()=>{reads++;return [459];});
 assert.deepEqual(value,[459]);assert.equal(reads,1);
});
test("only known connection errors are eligible",()=>{
 assert.equal(isTransientCatalogueConnectionFailure({code:"ECONNREFUSED"}),true);
 assert.equal(isTransientCatalogueConnectionFailure({code:"ECONNRESET"}),true);
 assert.equal(isTransientCatalogueConnectionFailure({code:"PROTOCOL_CONNECTION_LOST"}),true);
 assert.equal(isTransientCatalogueConnectionFailure({code:"ER_DUP_ENTRY"}),false);
 assert.equal(isTransientCatalogueConnectionFailure(undefined),false);
});
