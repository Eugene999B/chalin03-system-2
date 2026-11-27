"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {prepareCreditSale,consumeCreditApproval,reviewCreditRequest}=require("../services/customerCreditTransactionService");
const run=process.env.CHALIN03_CREDIT_DISPOSABLE_MYSQL==="true";
test("disposable MySQL: real migrations, concurrent credit, reviewer and recovery", {skip:!run,timeout:60000}, async()=>{
 const mysql=require("mysql2/promise");
 // Fixed local disposable CI fixture, never the application DB config.
 const pool=mysql.createPool({host:"127.0.0.1",port:3306,user:"credit_ci",password:"credit_ci_fixture",database:"credit_ci_fixture",multipleStatements:true,connectionLimit:4});
 const root=path.resolve(__dirname,"../../database/migrations");
 const fixture=`
 CREATE TABLE schema_migrations(migration_name VARCHAR(190) PRIMARY KEY,description VARCHAR(500),applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB;
 CREATE TABLE branches(id INT PRIMARY KEY) ENGINE=InnoDB;
 CREATE TABLE users(id INT PRIMARY KEY) ENGINE=InnoDB;
 CREATE TABLE customers(id INT PRIMARY KEY,branch_id INT NOT NULL,phone VARCHAR(30),FOREIGN KEY(branch_id) REFERENCES branches(id)) ENGINE=InnoDB;
 CREATE TABLE sales(id INT AUTO_INCREMENT PRIMARY KEY,branch_id INT NOT NULL,customer_id INT, total DECIMAL(12,2) NOT NULL DEFAULT 0,tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,sale_status VARCHAR(20) NOT NULL DEFAULT 'completed',is_voided TINYINT NOT NULL DEFAULT 0) ENGINE=InnoDB;
 CREATE TABLE debts(id INT AUTO_INCREMENT PRIMARY KEY,branch_id INT NOT NULL,sale_id INT NOT NULL,customer_id INT,customer_phone VARCHAR(30),balance DECIMAL(12,2) NOT NULL) ENGINE=InnoDB;
 CREATE TABLE debt_payments(id INT AUTO_INCREMENT PRIMARY KEY,branch_id INT NOT NULL,debt_id INT NOT NULL,amount DECIMAL(12,2) NOT NULL) ENGINE=InnoDB;
 CREATE TABLE sale_items(id INT AUTO_INCREMENT PRIMARY KEY,sale_id INT NOT NULL,quantity INT NOT NULL,cost_price_at_sale DECIMAL(12,2) NOT NULL) ENGINE=InnoDB;
 INSERT INTO branches VALUES (1),(2);
 INSERT INTO users VALUES(2),(3);
 INSERT INTO customers VALUES(7,1,'0240000000');
 INSERT INTO sales(branch_id,customer_id,total) VALUES(1,7,23000);
 INSERT INTO debts(branch_id,sale_id,customer_id,customer_phone,balance) VALUES(1,1,7,'0240000000',23000);
 `;
 const fullSchema=process.env.CHALIN03_CREDIT_FULL_SCHEMA==="true";
 const fullFixture=`
 INSERT INTO branches(id,code,branch_code,name) VALUES(1,'CI1','CI1','Synthetic Store One'),(2,'CI2','CI2','Synthetic Store Two');
 INSERT INTO users(id,full_name,username,password_hash,role,default_branch_id) VALUES(2,'Synthetic Employee','credit-ci-employee','not-a-login-secret','cashier',1),(3,'Synthetic Reviewer','credit-ci-reviewer','not-a-login-secret','admin',1);
 INSERT INTO customers(id,branch_id,name,phone) VALUES(7,1,'Synthetic Customer','0240000000');
 INSERT INTO sales(branch_id,receipt_number,customer_id,customer_name,total,payment_type,balance) VALUES(1,'CI-INITIAL',7,'Synthetic Customer',23000,'credit',23000);
 INSERT INTO debts(branch_id,sale_id,customer_id,customer_name,customer_phone,amount_owed,balance) VALUES(1,1,7,'Synthetic Customer','0240000000',23000,23000);
 `;
 const migrationNames=["20261125_customer_credit_foundation","20261125_customer_credit_approval_queue","20261125_sale_item_ownership_evidence","20261125_management_planning_settings"];
 const args=(key,total)=>({branchId:1,customerId:7,userId:2,requestKey:key,payload:{customer_id:7,total},total,paid:0,businessDate:"2026-01-31"});
 async function transaction(fn){
  const db=await pool.getConnection();
  try{await db.beginTransaction();await db.query("SELECT id FROM branches WHERE id=1 FOR UPDATE");const result=await fn(db);await db.commit();return result;}
  catch(e){await db.rollback();throw e;}finally{db.release();}
 }
 async function checkout(key,total){
  return transaction(async db=>{
    const r=await prepareCreditSale(db,args(key,total));
    if(r.pending)return r;
    const [sale]=fullSchema?await db.query("INSERT INTO sales(branch_id,receipt_number,customer_id,customer_name,total,payment_type,balance) VALUES(1,?,7,\'Synthetic Customer\',?,\'credit\',?)",["CI-"+key,total,total]):await db.query("INSERT INTO sales(branch_id,customer_id,total) VALUES(1,7,?)",[total]);
    if(fullSchema)await db.query("INSERT INTO debts(branch_id,sale_id,customer_id,customer_name,customer_phone,amount_owed,balance,due_date) VALUES(1,?,7,'Synthetic Customer','0240000000',?,?,?)",[sale.insertId,total,total,r.dueDate]);
    else await db.query("INSERT INTO debts(branch_id,sale_id,customer_id,customer_phone,balance) VALUES(1,?,7,'0240000000',?)",[sale.insertId,total]);
    await consumeCreditApproval(db,r.approvalId,sale.insertId);return {...r,saleId:sale.insertId};
  });
 }
 try{
  await pool.query(fullSchema?fullFixture:fixture);
  const {applyAndVerify}=require("../scripts/runCustomerCreditPlanningMigration");
  const conn=await pool.getConnection();
  try{assert.deepEqual(await applyAndVerify(conn),{verified:true,migrations:4,tables:7});}finally{conn.release();}

  for(const name of migrationNames)await pool.query(fs.readFileSync(path.join(root,name+".sql"),"utf8"));
  const [profiles]=await pool.query("SELECT score FROM customer_credit_profiles WHERE customer_id=7");assert.equal(Number(profiles[0].score),30);
  const keys=["credit-concurrent-0001","credit-concurrent-0002"];
  const results=await Promise.all(keys.map(key=>checkout(key,1500)));
  assert.equal(results.filter(x=>x.pending).length,1);
  const index=results.findIndex(x=>x.pending), pending=results[index], posted=results[1-index];
  assert.equal(posted.dueDate,"2026-02-28");
  await assert.rejects(checkout(keys[1-index],1500),{code:"CREDIT_ALREADY_EXECUTED"});
  await assert.rejects(transaction(db=>reviewCreditRequest(db,{branchId:1,reviewerId:2,requestId:Number(pending.id),action:"approve",reason:"Self review"})),{code:"CREDIT_REVIEW_CONFLICT"});
  await transaction(db=>reviewCreditRequest(db,{branchId:1,reviewerId:3,requestId:Number(pending.id),action:"approve",reason:"Independent approved exception"}));
  const {loadCreditProfile}=require("../services/customerCreditProfileService");
  const profile=await loadCreditProfile(pool,{branchId:1,customerId:7});
  assert.equal(profile.outstanding,24500);assert.equal(profile.reserved,1500);assert.equal(profile.available,0);
  const recovered=await checkout(keys[index],1500);assert.ok(recovered.saleId);
  await assert.rejects(checkout(keys[index],1500),{code:"CREDIT_ALREADY_EXECUTED"});
  const [debts]=await pool.query("SELECT SUM(balance) AS balance,COUNT(*) AS n FROM debts");assert.equal(Number(debts[0].balance),26000);assert.equal(Number(debts[0].n),3);
  if(fullSchema)await pool.query("INSERT INTO customers(id,branch_id,name,phone) VALUES(8,2,'Synthetic Duplicate','+233240000000')");
  else await pool.query("INSERT INTO customers VALUES(8,2,'+233240000000')");
  const {assertUnambiguousCreditIdentity}=require("../services/customerCreditIdentityGuard");
  await transaction(db=>assertUnambiguousCreditIdentity(db,{customerId:7,phone:"0240000000"}));
  await assert.rejects(transaction(db=>assertUnambiguousCreditIdentity(db,{customerId:8,phone:"+233240000000"})),{code:"CREDIT_IDENTITY_RECONCILIATION_REQUIRED"});
  const [after]=await pool.query("SELECT COUNT(*) AS n FROM debts");assert.equal(Number(after[0].n),3);
  const {readOwnershipReceiptPreview}=require("../services/ownershipReceiptPreviewService");
  const report=await readOwnershipReceiptPreview(pool,1);assert.equal(report.groups.unresolved.invoice_total,2600000);assert.equal(report.total.outstanding,2600000);
  const {readScenario}=require("../services/managementPlanningService");
  const scenario=await readScenario(pool,1);assert.equal(scenario.assumed_partner_percent,40);assert.equal(scenario.estimated_company_amount,1560000);
  await pool.query("UPDATE management_planning_settings SET assumed_partner_percent=25,version=version+1 WHERE id=1");
  const changed=await readScenario(pool,1);assert.equal(changed.estimated_company_amount,1950000);assert.equal(changed.actual_invoice_total,2600000);
  for(const name of migrationNames)await pool.query(fs.readFileSync(path.join(root,name+"_verify.sql"),"utf8"));
 }finally{await pool.end();}
});
