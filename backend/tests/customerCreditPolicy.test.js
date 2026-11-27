const test = require("node:test");
const assert = require("node:assert/strict");
const {creditLimit,evaluateCredit,debtDueDate,INITIAL_SCORE,MAX_LIMIT} = require("../services/customerCreditPolicy");

test("required limits and monotonicity", () => {
  assert.equal(INITIAL_SCORE,30);
  assert.equal(creditLimit(),2500000);
  assert.equal(creditLimit(0),0);
  assert.equal(creditLimit(60),10000000);
  assert.equal(creditLimit(100),MAX_LIMIT);
  for(let s=1;s<=100;s++) assert.ok(creditLimit(s)>creditLimit(s-1));
});
test("existing over-limit debtor can still pay in full", () => {
  const result=evaluateCredit({outstanding:3000000,total:100000,paid:100000});
  assert.equal(result.decision,"fully_paid");
  assert.equal(result.available,0);
  assert.equal(result.outstanding,3000000);
});
test("partial payments, exact limits and over-limit purchases", () => {
  const data={outstanding:2300000,total:300000,paid:100000};
  assert.equal(evaluateCredit(data).decision,"within_limit");
  assert.equal(evaluateCredit({...data,paid:99999}).decision,"approval_required");
  assert.equal(evaluateCredit({...data,reserved:1}).decision,"approval_required");
  assert.equal(evaluateCredit({outstanding:2500000,total:1,paid:0}).decision,"approval_required");
});
test("reject invalid monetary inputs and scores", () => {
  for(const bad of [-1,101,NaN,30.5,"30"]) assert.throws(()=>creditLimit(bad));
  const data={outstanding:0,total:100,paid:0};
  for(const bad of [-1,101,NaN,0.1,"10"]) assert.throws(()=>evaluateCredit({...data,paid:bad}));
  assert.throws(()=>evaluateCredit({...data,outstanding:-1}));
  assert.throws(()=>evaluateCredit({...data,total:0}));
  assert.throws(()=>evaluateCredit({...data,outstanding:Number.MAX_SAFE_INTEGER,reserved:1}));
});
test("one calendar month, leap year, configurable term and invalid date", () => {
  assert.equal(debtDueDate("2026-01-31"),"2026-02-28");
  assert.equal(debtDueDate("2028-01-31"),"2028-02-29");
  assert.equal(debtDueDate("2026-12-31"),"2027-01-31");
  assert.equal(debtDueDate("2026-11-25",2),"2027-01-25");
  assert.throws(()=>debtDueDate("2026-02-30"));
  assert.throws(()=>debtDueDate("2026-11-25",0));
});
