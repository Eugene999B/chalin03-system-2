const test=require("node:test");
const assert=require("node:assert/strict");
const {enabled,prepareCreditSale,consumeCreditApproval}=require("../services/customerCreditTransactionService");
const {sealSalePayload}=require("../services/customerCreditApprovalPolicy");
const input={branchId:1,customerId:7,userId:2,requestKey:"test-credit-key-0001",payload:{customer_id:7,total:3000},total:3000,paid:0,businessDate:"2026-01-31"};
function db({prior=null,balance="23000.00",reserved="0"}={}){
  const calls=[];
  return {calls,query:async(sql,args)=>{
    calls.push({sql,args});
    if(sql.startsWith("SELECT id,status"))return [[...(prior?[prior]:[])]];
    if(sql.startsWith("SELECT id FROM customers"))return [[{id:7}]];
    if(sql.startsWith("SELECT score"))return [[{score:30}]];
    if(sql.startsWith("SELECT term_months"))return [[{term_months:1}]];
    if(sql.startsWith("SELECT d.balance"))return [[{balance}]];
    if(sql.startsWith("SELECT COALESCE"))return [[{reserved}]];
    if(sql.startsWith("INSERT INTO customer_credit"))return [{insertId:11}];
    if(sql.startsWith("UPDATE customer_credit"))return [{affectedRows:1}];
    throw Error("Unexpected SQL: "+sql);
  }};
}
test("staging flags both required",()=>{
 assert.equal(enabled({CHALIN03_CREDIT_PREVIEW:"true"}),false);
 assert.equal(enabled({CHALIN03_CREDIT_PREVIEW:"true",CHALIN03_CREDIT_ENFORCEMENT_PREVIEW:"true"}),true);
});
test("over limit stores pending approval only; exact limit gets calendar month",async()=>{
 const d=db();
 assert.deepEqual(await prepareCreditSale(d,input),{pending:true,id:"11"});
 assert.ok(d.calls.some(c=>c.sql.startsWith("INSERT INTO customer_credit")));
 assert.equal(d.calls.some(c=>/INSERT INTO (sales|debts)|UPDATE products/.test(c.sql)),false);
 const d2=db();
 assert.deepEqual(await prepareCreditSale(d2,{...input,total:2000}),{approvalId:11,dueDate:"2026-02-28"});
 assert.equal(d2.calls.find(c=>c.sql.startsWith("INSERT")).args.at(-1),"approved");
});
test("approved exact payload can be consumed once, altered and executed requests rejected",async()=>{
 const prior={id:11,status:"approved",customer_id:7,active:1,payload_sha256:sealSalePayload(input.payload).hash};
 const d=db({prior});
 assert.deepEqual(await prepareCreditSale(d,input),{approvalId:11,dueDate:"2026-02-28"});
 await consumeCreditApproval(d,11,91);
 assert.deepEqual(d.calls.at(-1).args,[91,11]);
 await assert.rejects(prepareCreditSale(db({prior}),{...input,payload:{...input.payload,total:4000}}),{code:"CREDIT_REQUEST_CHANGED"});
 await assert.rejects(prepareCreditSale(db({prior:{...prior,status:"executed",executed_sale_id:91}}),input),{code:"CREDIT_ALREADY_EXECUTED"});
 await assert.rejects(consumeCreditApproval({query:async()=>[{affectedRows:0}]},11,91),{code:"CREDIT_APPROVAL_NOT_ACTIVE"});
});

test("recovery cannot be posted in a different store or request context",async()=>{
 const prior={id:11,status:"approved",customer_id:7,active:1,payload_sha256:sealSalePayload(input.payload).hash};
 await assert.rejects(prepareCreditSale(db(),{...input,recoveryId:"11"}),{code:"CREDIT_RECOVERY_SCOPE_CHANGED"});
 await assert.rejects(prepareCreditSale(db({prior}),{...input,recoveryId:"12"}),{code:"CREDIT_RECOVERY_SCOPE_CHANGED"});
 assert.equal((await prepareCreditSale(db({prior}),{...input,recoveryId:"11"})).approvalId,11);
});
