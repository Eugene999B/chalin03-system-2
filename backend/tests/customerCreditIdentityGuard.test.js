const test=require("node:test"),assert=require("node:assert/strict");
const {ghPhone,assertUnambiguousCreditIdentity}=require("../services/customerCreditIdentityGuard");
test("normalizes Ghana phone formats without treating invalid lengths as verified",()=>{
 for(const p of ["024 000 0000","+233240000000","00233240000000","240000000"])assert.equal(ghPhone(p),"240000000");
 assert.equal(ghPhone("1234"),null);
});
test("potential duplicate and unlinked debt require review instead of merging",async()=>{
 const args={customerId:7,phone:"0240000000"};
 await assert.rejects(assertUnambiguousCreditIdentity({query:async()=>[[{id:99}]]},args),{code:"CREDIT_IDENTITY_RECONCILIATION_REQUIRED"});
 let calls=0;
 await assert.rejects(assertUnambiguousCreditIdentity({query:async()=>[++calls===1?[]:[{id:33}]]},args),{code:"CREDIT_LEGACY_DEBT_RECONCILIATION_REQUIRED"});
 await assertUnambiguousCreditIdentity({query:async()=>[[]]},args);
});
