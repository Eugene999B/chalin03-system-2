"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const {
 canChangeMasterPriceDirectly,normalizePrice,priceSnapshot,
 proposedPriceSnapshot,validatePriceChange,changedPriceFields
}=require("../services/productPriceApprovalPolicy");
const {actionRoute}=require("../services/operationalApprovalService");
const root=path.resolve(__dirname,"../..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");

test("verified owner, Boss and Auditor are the only direct master price authorities",async()=>{
 assert.equal(await canChangeMasterPriceDirectly({role:"manager"}),false);
 assert.equal(await canChangeMasterPriceDirectly({role:"cashier"}),false);
 assert.equal(await canChangeMasterPriceDirectly({role:"staff"}),false);
 assert.equal(await canChangeMasterPriceDirectly({role:"auditor"}),true);
 assert.equal(await canChangeMasterPriceDirectly({id:1,username:"admin",role:"admin"}),true);
 const db={query:async()=>[[{id:57,full_name:"Agyapong Charles",role:"admin",is_active:1}]]};
 assert.equal(await canChangeMasterPriceDirectly({id:57,username:"boss",role:"admin"},db),true);
 assert.equal(await canChangeMasterPriceDirectly({id:58,username:"another_admin",role:"admin"},db),false);
});

test("old and proposed price values retain exact two-decimal GHS precision",()=>{
 for(const v of ["-1","1.001","abc",null,undefined,{},NaN,Infinity])assert.equal(normalizePrice(v),null);
 assert.equal(normalizePrice("125.40"),"125.40");
 assert.equal(normalizePrice(0),"0.00");
 const current={cost_price:"60.00",selling_price:"105.00"};
 assert.deepEqual(priceSnapshot(current),current);
 assert.deepEqual(proposedPriceSnapshot(current,{selling_price:115}),{
   cost_price:"60.00",selling_price:"115.00"
 });
 assert.deepEqual(changedPriceFields(current,{cost_price:"60.00",selling_price:"115.00"}),["selling_price"]);
 assert.equal(validatePriceChange({product:current,values:{selling_price:105}}).code,"PRODUCT_PRICE_UNCHANGED");
});

test("approved price action targets only signed master-price execution endpoint",()=>{
 assert.deepEqual(actionRoute({approval_kind:"product_price_change",entity_id:200}),
   {method:"POST",path:"/api/products/200/approved-price"});
 assert.equal(actionRoute({approval_kind:"product_price_change",entity_id:"abc"}),null);
 const priceRoutes=read("backend/routes/productPriceApprovalRoutes.js");
 const bootstrap=read("backend/server.js");
 assert.match(priceRoutes,/operationalApprovalExecutionMiddleware,applyApprovedPrice/);
 assert.match(priceRoutes,/PRICE_APPROVAL_EXECUTION_REQUIRED/);
 assert.match(priceRoutes,/FOR UPDATE/);
 assert.match(priceRoutes,/STALE_PRICE_APPROVAL/);
 assert.match(priceRoutes,/execution_status='executed'/);
 assert.match(priceRoutes,/hashPayload\(payload\)/);
 assert.match(priceRoutes,/price_fields:changed/);
 assert.match(priceRoutes,/PRICE_CHANGE_REASON_REQUIRED/);
 assert.match(bootstrap,/sparePartsBoundary, productPriceApprovalRoutes/);
 assert.doesNotMatch(bootstrap,/sparePartsBoundary, operationalApprovalExecutionMiddleware, productPriceApprovalRoutes/);
});

test("manager product editor, purchasing and restock cannot overwrite master prices",()=>{
 const products=read("backend/routes/productRoutes.js");
 const purchases=read("backend/routes/purchaseRoutes.js");
 assert.match(products,/cost_price = CASE WHEN \? THEN \? ELSE cost_price END/);
 assert.match(products,/selling_price = CASE WHEN \? THEN \? ELSE selling_price END/);
 assert.match(products,/PRICE_CHANGE_REASON_REQUIRED/);
 assert.match(products,/RESTOCK_MASTER_COST_NEEDS_APPROVAL/);
 assert.match(products,/DIRECT_PRODUCT_MASTER_PRICE_CHANGE/);
 assert.match(purchases,/cost_price=CASE WHEN \? THEN \? ELSE cost_price END/);
});

test("auditor review is restricted to price changes; all staff can track their requests",()=>{
 const approval=read("backend/routes/operationalApprovalRoutes.js");
 const service=read("backend/services/operationalApprovalService.js");
 assert.match(approval,/AUDITOR_PRICE_ONLY/);
 assert.match(approval,/PRICE_REVIEWER_NOT_AUTHORIZED/);
 assert.match(approval,/requireEmployee/);
 assert.match(service,/approvalKind === "product_price_change"/);
 assert.match(service,/userCanAccessBranch/);
 assert.match(service,/SELF_APPROVAL_FORBIDDEN/);
 assert.match(service,/bcrypt\.compare/);
});
