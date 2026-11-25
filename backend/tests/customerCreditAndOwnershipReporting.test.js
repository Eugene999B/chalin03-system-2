const test=require("node:test");
const assert=require("node:assert/strict");
const {reconcileOwnershipReport}=require("../services/businessOwnershipReportingPolicy");
const {toPesewas,describeCredit,assessPreparedSale,loadCreditProfile}=require("../services/customerCreditProfileService");
test("currency conversion, exact remaining credit and monthly date",()=>{
  assert.equal(toPesewas("123.05"),12305);
  assert.throws(()=>toPesewas("12.001"));
  assert.throws(()=>toPesewas("-1"));
  const profile=describeCredit({outstanding:"23000.00"});
  assert.equal(profile.available,2000);
  assert.equal(assessPreparedSale({profile,total:"3000.00",paid:"1000.00",reserved:"0",businessDate:"2026-01-31"}).due_date,"2026-02-28");
  assert.equal(assessPreparedSale({profile,total:"3000.00",paid:"1000.00",reserved:"0.01",businessDate:"2026-01-31"}).decision,"approval_required");
});
test("canonical credit profile respects authenticated branch",async()=>{
  const calls=[];
  const db={query:async(sql,args)=>{calls.push(args);return calls.length===1?[[{score:30,term_months:1}]]:[[{outstanding:"27000.00"}]];}};
  const p=await loadCreditProfile(db,{branchId:2,customerId:5});
  assert.deepEqual(calls,[[5,2],[5,2,2,5]]);
  assert.equal(p.available,0);
  assert.equal(p.over_limit,true);
  assert.equal(await loadCreditProfile({query:async()=>[[]]},{branchId:1,customerId:5}),null);
});
const allocations=[
  {allocationId:"line1",owner:"chalin03",evidenceRef:"stock-ledger-1",netRevenue:50000,cost:30000,receivable:20000,collections:30000},
  {allocationId:"line2",owner:"partner",evidenceRef:"stock-ledger-2",netRevenue:30000,cost:25000,receivable:10000,collections:20000},
  {allocationId:"line3",owner:"unclassified",netRevenue:10000,cost:8000,receivable:10000,collections:0}
];
const ledgerTotals={netRevenue:90000,cost:63000,receivable:40000,collections:50000};
test("ownership reporting reconciles full ledger and retains unclassified lines",()=>{
  const result=reconcileOwnershipReport({allocations,ledgerTotals});
  assert.equal(result.full.grossProfit,27000);
  assert.equal(result.groups.chalin03.grossProfit,20000);
  assert.equal(result.groups.partner.receivable,10000);
  assert.equal(result.groups.unclassified.netRevenue,10000);
  assert.equal(result.reconciliationRequired,true);
});
test("reject missing evidence, duplicate allocation, and mismatched ledger",()=>{
  assert.throws(()=>reconcileOwnershipReport({allocations:[{...allocations[0],evidenceRef:""}],ledgerTotals}));
  assert.throws(()=>reconcileOwnershipReport({allocations:[...allocations,allocations[0]],ledgerTotals}));
  assert.throws(()=>reconcileOwnershipReport({allocations,ledgerTotals:{...ledgerTotals,netRevenue:89999}}));
});

test("available credit includes approved reservations",()=>{const p=describeCredit({outstanding:"23000.00",reserved:"1500.00"});assert.equal(p.available,500);assert.equal(p.exposure,24500);assert.equal(p.utilization_percent,98);});
