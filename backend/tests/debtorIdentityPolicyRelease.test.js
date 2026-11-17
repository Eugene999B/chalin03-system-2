"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {
  isRealTwoPartName,cleanPhone,requiredIdentityFields,
  ensureDebtCustomerIdentity
}=require("../services/debtorIdentityPolicy");
const {
  SMS_TEXT,sourceReference,collectRecipients,classifySubmission
}=require("../services/debtorIdentityStaffNoticeService");
const read=(p)=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");

test("only two distinct alphabetic names and a valid Ghana phone complete identity",()=>{
  for(const bad of ["","Kojo","123 456","2026 400","John John","John 400","A A","null"]){
    assert.equal(isRealTwoPartName(bad),false,bad);
  }
  for(const good of ["Appiah Eugene","Ama Serwaa","José Mensah","Abdul-Rahman Osei"]){
    assert.equal(isRealTwoPartName(good),true,good);
  }
  assert.equal(cleanPhone("0241234567"),"+233241234567");
  assert.equal(cleanPhone("+233241234567"),"+233241234567");
  assert.equal(cleanPhone("123456"),"");
  assert.deepEqual(requiredIdentityFields({name:"123 456",phone:""}),["customer_name","customer_phone"]);
  assert.deepEqual(requiredIdentityFields({name:"Ama Serwaa",phone:"0241234567"}),[]);
});

function simulatedConnection(profile){
  const queries=[];
  return {
    queries,
    query:async(sql,args=[])=>{
      queries.push({sql,params:args});
      if(sql.includes("SELECT id,name,phone FROM customers"))return [[profile]];
      return [{affectedRows:1}];
    }
  };
}
const req={user:{id:18},headers:{"x-test-case":"synthetic"}};
test("linked historical debtor is corrected in master customer, without a sale or balance update",async()=>{
  const connection=simulatedConnection({id:42,name:"444",phone:null});
  const audits=[];
  const result=await ensureDebtCustomerIdentity(connection,{
    branchId:7,debts:[{id:9,customer_id:42,effective_customer_id:42,
      customer_name:"444",customer_phone:"",sale_id:11}],
    body:{customer_name:"Ama Boateng",customer_phone:"0241234567"},
    req,writeAuditEvent:async(event)=>audits.push(event)
  });
  assert.equal(result.changed,true);
  assert.equal(result.name,"Ama Boateng");
  assert.equal(result.phone,"+233241234567");
  assert.ok(connection.queries.some(q=>q.sql.startsWith("UPDATE customers SET")));
  assert.ok(connection.queries.every(q=>!/(UPDATE sales|UPDATE debts|INSERT INTO debt_payments)/.test(q.sql)));
  assert.equal(audits[0].metadata.original_sale_receipts_preserved,true);
  assert.deepEqual(audits[0].metadata.fields_completed,["customer_name","customer_phone"]);
  assert.equal(audits[0].entityType,"customer");
});
test("unlinked legacy debtor changes only current debt identity and never historical receipts",async()=>{
  const connection=simulatedConnection();
  const audits=[];
  const result=await ensureDebtCustomerIdentity(connection,{
    branchId:4,debts:[{id:55,customer_id:null,effective_customer_id:null,
      customer_name:"1234",customer_phone:""}],
    body:{customer_name:"Kwesi Mensah",customer_phone:"0201234567"},req,
    writeAuditEvent:async(event)=>audits.push(event)
  });
  assert.equal(result.changed,true);
  assert.ok(connection.queries.some(q=>q.sql.startsWith("UPDATE debts SET customer_name")));
  assert.ok(connection.queries.every(q=>!/(UPDATE sales|UPDATE customers|UPDATE debts SET amount)/.test(q.sql)));
  assert.equal(audits[0].entityType,"legacy_debt");
});
test("missing identity prevents correction with no writes and clear missing-fields evidence",async()=>{
  const connection=simulatedConnection({id:42,name:"111 222",phone:""});
  await assert.rejects(
    ()=>ensureDebtCustomerIdentity(connection,{
      branchId:7,debts:[{id:9,customer_id:42,effective_customer_id:42}],
      body:{customer_name:"John John",customer_phone:"0241234567"},req,
      writeAuditEvent:async()=>{throw Error("Must not audit rejected correction")}
    }),
    error=>error.statusCode===409&&error.code==="DEBT_CUSTOMER_IDENTITY_REQUIRED"&&
      error.missing_fields.includes("customer_name")
  );
  assert.ok(connection.queries.every(q=>!q.sql.startsWith("UPDATE")));
});
test("valid linked customer ignores attempted profile replacement during payment",async()=>{
  const connection=simulatedConnection({id:3,name:"Abena Mensah",phone:"0241234567"});
  const result=await ensureDebtCustomerIdentity(connection,{
    branchId:2,debts:[{id:4,customer_id:3,effective_customer_id:3}],
    body:{customer_name:"Other Person",customer_phone:"0201234567"},req,
    writeAuditEvent:async()=>{throw Error("No audit needed")}
  });
  assert.equal(result.changed,false);
  assert.equal(result.name,"Abena Mensah");
  assert.ok(connection.queries.every(q=>!q.sql.startsWith("UPDATE")));
});
test("new credit debt and both payment routes enforce identity before money changes",()=>{
  const sales=read("routes/saleRoutes.js");
  const debts=read("routes/debtRoutes.js");
  assert.match(sales,/const createsDebt=payment\.balance>0/);
  assert.ok(sales.indexOf("const createsDebt=payment.balance>0")<sales.indexOf("INSERT INTO sales ("));
  const customerPayment=debts.indexOf('router.post("/customers/:customerKey/payments"');
  const singlePayment=debts.indexOf('router.post(\n  "/:id/payments"');
  assert.ok(customerPayment>0&&singlePayment>customerPayment);
  const customerSegment=debts.slice(customerPayment,singlePayment);
  assert.ok(customerSegment.indexOf("ensureDebtCustomerIdentity")<
    customerSegment.indexOf("applyPaymentToDebt("));
  const singleSegment=debts.slice(singlePayment);
  assert.ok(singleSegment.indexOf("ensureDebtCustomerIdentity")<
    singleSegment.indexOf("applyPaymentToDebt("));
  assert.match(debts,/router\.post\("\/customers\/:customerKey\/identity",requireAuth/);
  assert.match(debts,/identity_requirements/);
  assert.match(debts,/original_sale_receipts_preserved/);
});
test("all-staff notice deduplicates contact numbers and never targets customer phone rows",()=>{
  assert.match(SMS_TEXT,/CHALIN03 NOTICE/);
  const recipients=collectRecipients([
    {role:"admin",phone:"0241234567"},
    {role:"cashier",phone:"+233241234567"},
    {role:"manager",phone:"0201234567"},
    {role:"auditor",phone:null}
  ],[{kind:"office",phone:"0241234567"}]);
  assert.equal(recipients.length,2);
  assert.notEqual(sourceReference(recipients[0].phone),sourceReference(recipients[1].phone));
  assert.equal(classifySubmission({status:"accepted"}),"accepted");
  assert.equal(classifySubmission({status:"unknown"}),"delivery_unknown");
  const source=read("services/debtorIdentityStaffNoticeService.js");
  assert.match(source,/WHERE is_active=1/);
  assert.match(source,/GET_LOCK/);
  assert.match(source,/WHERE source_reference=\?/);
  assert.match(source,/INSERT INTO sms_log/);
  assert.match(source,/no automatic retry/i);
  assert.doesNotMatch(source,/FROM customers/);
  const server=read("server.js");
  assert.match(server,/dispatchStaffDebtorIdentityNoticeOnce/);
  const app=fs.readFileSync(path.join(__dirname,"../../frontend/src/App.jsx"),"utf8");
  assert.match(app,/DebtorIdentityStaffAnnouncement/);
});
