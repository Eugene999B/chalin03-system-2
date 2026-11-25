const test=require("node:test"),assert=require("node:assert/strict");
const {ghPhone,assertUnambiguousCreditIdentity}=require("../services/customerCreditIdentityGuard");
test("normalizes Ghana phone formats without treating invalid lengths as verified",()=>{
 for(const p of ["024 000 0000","+233240000000","00233240000000","240000000"])assert.equal(ghPhone(p),"240000000");
 assert.equal(ghPhone("1234"),null);
});
test("only matching debtor exposure requires review; ordinary customers do not",async()=>{
 const args={customerId:7,phone:"0240000000"};
 function db(responses){let i=0;return {query:async()=>[responses[i++]||[]]};}
 await assertUnambiguousCreditIdentity(db([[{id:99}],[],[],[]]),args);
 await assert.rejects(assertUnambiguousCreditIdentity(db([[{id:99}],[{id:4}],[]]),args),{code:"CREDIT_IDENTITY_RECONCILIATION_REQUIRED"});
 await assert.rejects(assertUnambiguousCreditIdentity(db([[{id:99}],[],[{id:4}]]),args),{code:"CREDIT_IDENTITY_RECONCILIATION_REQUIRED"});
 await assert.rejects(assertUnambiguousCreditIdentity(db([[],[{id:33}]]),args),{code:"CREDIT_LEGACY_DEBT_RECONCILIATION_REQUIRED"});
 await assertUnambiguousCreditIdentity(db([[],[]]),args);
});
