const test=require("node:test");
const assert=require("node:assert/strict");
const {sealSalePayload,verifyPayload,reviewDecision,sumActiveReservations,recoverSalePayload}=require("../services/customerCreditApprovalPolicy");
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

test("recovery reconstructs only allowed sale inputs and rejects tampering",()=>{
 const payload={customer_id:7,customer_name:"Test Customer",customer_phone:"0240000000",customer_location:null,payment_type:"credit",discount_amount:0,tendered:0,paid:0,total:3000,allocations:{cash:0,momo:0,bank:0,other:0},items:[{product_id:4,quantity:2,unit_price:1500,line_total:3000}]};
 const hash=sealSalePayload(payload).hash;
 const recovered=recoverSalePayload(JSON.stringify(payload),hash);
 assert.deepEqual(recovered.items,[{product_id:4,quantity:2}]);
 assert.equal(recovered.customer_id,7);
 assert.equal(recovered.amount_paid,0);
 assert.equal("total" in recovered,false);
 assert.throws(()=>recoverSalePayload({...payload,paid:100},hash));
});
