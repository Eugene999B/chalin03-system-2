"use strict";
const DAY=86400000,DEFAULT_GRACE_DAYS=30,MARKER="20261125_debt_grace_reset_30_days";
function dateOnly(value){
 const text=value instanceof Date?value.toISOString().slice(0,10):String(value||"").slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(text))throw new RangeError("Valid sale date required");
 const date=new Date(text+"T00:00:00Z");
 if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==text)throw new RangeError("Invalid date");
 return text;
}
function calculateDebtDueDate(saleDate,days=DEFAULT_GRACE_DAYS){
 const n=Number(days);
 const term=Number.isInteger(n)&&n>0&&n<=3650?n:DEFAULT_GRACE_DAYS;
 return new Date(Date.parse(dateOnly(saleDate)+"T00:00:00Z")+term*DAY).toISOString().slice(0,10);
}
// Existing overdue debts receive a one-time new grace period; existing future
// extensions are never shortened. Old due dates stay in the audit trail.
function resetDueDate({saleDate,oldDueDate,resetDate}){
 const today=dateOnly(resetDate),saleDue=calculateDebtDueDate(saleDate);
 const previous=oldDueDate?dateOnly(oldDueDate):null;
 const expired=previous?previous<today:saleDue<today;
 const proposed=expired?calculateDebtDueDate(today):saleDue;
 return previous&&previous>proposed?previous:proposed;
}
async function applyGraceReset(connection){
 let held=false,transaction=false;
 try{
  const [[lock]]=await connection.query("SELECT GET_LOCK(?,30) AS acquired",[MARKER]);held=Number(lock?.acquired)===1;
  if(!held)throw Error("Debt grace reset lock unavailable");
  await connection.beginTransaction();transaction=true;
  const [prior]=await connection.query("SELECT migration_name FROM schema_migrations WHERE migration_name=? FOR UPDATE",[MARKER]);
  if(prior.length){await connection.rollback();transaction=false;return {already_applied:true};}
  const [[clock]]=await connection.query("SELECT DATE_FORMAT(UTC_DATE(),'%Y-%m-%d') AS reset_date");
  const resetDate=clock.reset_date;
  const [settings]=await connection.query("SELECT id,branch_id,debt_reminder_days FROM settings ORDER BY branch_id,id FOR UPDATE");
  if(!settings.length)throw Error("No existing store settings found");
  const [rows]=await connection.query("SELECT d.id,d.branch_id,DATE_FORMAT(d.due_date,'%Y-%m-%d') AS previous_due_date,DATE_FORMAT(s.created_at,'%Y-%m-%d') AS sale_date FROM debts d JOIN sales s ON s.id=d.sale_id AND s.branch_id=d.branch_id WHERE d.balance>0 AND d.status IN ('unpaid','partial') AND s.is_voided=0 AND s.sale_status='completed' AND s.payment_type IN ('credit','mixed') ORDER BY d.branch_id,d.id FOR UPDATE");
  const audit=async(branchId,action,details)=>{const [result]=await connection.query("INSERT INTO activity_log (branch_id,user_id,action,details) VALUES (?,NULL,?,?)",[branchId,action,JSON.stringify(details)]);if(!result.insertId)throw Error("Required grace reset audit could not be saved");};
  let changed=0,renewed=0;
  for(const setting of settings){
   if(Number(setting.debt_reminder_days)===30)continue;
   await audit(setting.branch_id,"DEBT_GRACE_POLICY_UPDATED",{release:MARKER,settings_id:setting.id,previous_days:Number(setting.debt_reminder_days),new_days:30,reason:"Management-approved 30-day grace period"});
   await connection.query("UPDATE settings SET debt_reminder_days=30 WHERE id=? AND branch_id=?",[setting.id,setting.branch_id]);
  }
  for(const row of rows){
   const newDueDate=resetDueDate({saleDate:row.sale_date,oldDueDate:row.previous_due_date,resetDate});
   if(newDueDate===row.previous_due_date)continue;
   await audit(row.branch_id,"DEBT_GRACE_PERIOD_RESET",{release:MARKER,debt_id:row.id,sale_date:row.sale_date,previous_due_date:row.previous_due_date,new_due_date:newDueDate,reset_date:resetDate,reason:"Management-approved one-time grace extension; original payment history unchanged"});
   const [updated]=await connection.query("UPDATE debts SET due_date=? WHERE id=? AND branch_id=? AND balance>0",[newDueDate,row.id,row.branch_id]);
   if(updated.affectedRows!==1)throw Error("Concurrent debt update during grace reset");
   changed++;if(newDueDate===calculateDebtDueDate(resetDate))renewed++;
  }
  await connection.query("INSERT INTO schema_migrations (migration_name,description) VALUES (?,?)",[MARKER,JSON.stringify({reset_date:resetDate,settings:settings.length,eligible_debts:rows.length,changed,renewed})]);
  await connection.commit();transaction=false;
  return {reset_date:resetDate,settings:settings.length,eligible_debts:rows.length,changed,renewed};
 }catch(error){if(transaction)await connection.rollback();throw error;}
 finally{if(held)await connection.query("SELECT RELEASE_LOCK(?)",[MARKER]);}
}
module.exports={DEFAULT_GRACE_DAYS,MARKER,calculateDebtDueDate,resetDueDate,applyGraceReset};
