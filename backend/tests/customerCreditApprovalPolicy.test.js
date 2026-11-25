const test=require("node:test");
const assert=require("node:assert/strict");
const {sealSalePayload,verifyPayload,reviewDecision,sumActiveReservations}=require("../services/customerCreditApprovalPolicy");
test("canonical hash binds the original sale details",()=>{
 const payload={customer_id:2,items:[{quantity:1,product_id:4}],total:250};
 const sealed=sealSalePayload(payload);
 assert.equal(verifyPayload({total:250,items:[{product_id:4,quantity:1}],customer_id:2},sealed.hash),true);
 assert.equal(verifyPayload({...payload,total:251},sealed.hash),false);
 assert.equal(verifyPayload(payload,"bad"),false);
});
const input={request:{branch_id:1,requested_by:2,status:"pending",expiresAtMs:2000,new_debt_pesewas:100000},reviewerId:3,branchId:1,action:"approve",now:1000,reason:"Verified exception",authoritativeExposure:19900000};
test("independent, unexpired, same-branch approval within absolute cap",()=>{
 assert.equal(reviewDecision(input).status,"approved");
 assert.throws(()=>reviewDecision({...input,reviewerId:2}));
 assert.throws(()=>reviewDecision({...input,branchId:2}));
 assert.throws(()=>reviewDecision({...input,now:2000}));
 assert.throws(()=>reviewDecision({...input,authoritativeExposure:19900001}));
 assert.throws(()=>reviewDecision({...input,request:{...input.request,status:"executed"}}));
 assert.equal(reviewDecision({...input,action:"reject",authoritativeExposure:undefined}).status,"rejected");
});
test("reservation query only counts approved nonexpired requests, with optional self exclusion",async()=>{
 const db={query:async(sql,args)=>{assert.match(sql,/status='approved'/);assert.match(sql,/expires_at>UTC_TIMESTAMP/);assert.deepEqual(args,[5,9,9]);return [[{reserved:"120000"}]];}};
 assert.equal(await sumActiveReservations(db,{customerId:5,excludeId:9}),120000);
});
