"use strict";
const {creditLimit, evaluateCredit, debtDueDate, INITIAL_SCORE, DEFAULT_TERM_MONTHS} = require("./customerCreditPolicy");

function toPesewas(value) {
  // mysql2 normally returns DECIMAL as a string. Reject excess precision.
  const raw = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw new RangeError("Invalid nonnegative money");
  const [whole, fraction = ""] = raw.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result)) throw new RangeError("Monetary value out of range");
  return result;
}

function describeCredit({score = INITIAL_SCORE, outstanding, termMonths = DEFAULT_TERM_MONTHS, reserved = 0}) {
  const balance = toPesewas(outstanding);
  const limit = creditLimit(score);
  const reservedPesewas=toPesewas(reserved), exposure=balance+reservedPesewas;
  if(!Number.isSafeInteger(exposure))throw new RangeError('Credit exposure out of range');
  return {
    score, limit: limit / 100, outstanding: balance / 100,
    reserved: reservedPesewas / 100,
    exposure: exposure / 100,
    available: Math.max(0, limit - exposure) / 100,
    utilization_percent: limit ? Math.round(exposure / limit * 10000) / 100 : null,
    term_months: termMonths,
    over_limit: exposure > limit,
    at_limit: exposure >= limit
  };
}

async function loadCreditProfile(db, {branchId, customerId}) {
  if (![branchId, customerId].every(v => Number.isSafeInteger(v) && v > 0)) {
    throw new RangeError("A valid branch and customer are required");
  }
  const [rows] = await db.query(
    `SELECT c.id, COALESCE(p.score, 30) AS score, COALESCE(p.version,1) AS version, COALESCE(cs.term_months,1) AS term_months
     FROM customers c
     LEFT JOIN customer_credit_profiles p ON p.customer_id=c.id
     LEFT JOIN customer_credit_settings cs ON cs.branch_id=c.branch_id
     WHERE c.id=? AND c.branch_id=?`, [customerId, branchId]
  );
  if (!rows.length) return null;
  const [balances] = await db.query(
    `SELECT COALESCE(SUM(d.balance),0) AS outstanding,
       (SELECT CAST(COALESCE(SUM(a.new_debt_pesewas),0)/100 AS DECIMAL(20,2)) FROM customer_credit_approval_requests a WHERE a.customer_id=? AND a.branch_id=? AND a.status='approved' AND a.expires_at>UTC_TIMESTAMP()) AS reserved
     FROM debts d LEFT JOIN sales s ON s.id=d.sale_id AND s.branch_id=d.branch_id
     WHERE d.branch_id=? AND COALESCE(s.customer_id,d.customer_id)=? AND d.balance>0`,
    [customerId, branchId, branchId, customerId]
  );
  const profile=describeCredit({score:Number(rows[0].score), outstanding:balances[0].outstanding, termMonths:Number(rows[0].term_months),reserved:balances[0].reserved??0});
  return {...profile,version:String(rows[0].version??1)};
}

// Caller must hold the customer lock and provide fresh authoritative exposure,
// including outstanding approved reservations. This helper never posts a sale.
function assessPreparedSale({profile, total, paid, reserved, businessDate}) {
  if (!profile) throw new Error("Canonical customer is required");
  const result = evaluateCredit({
    score:profile.score, outstanding:toPesewas(profile.outstanding),
    reserved:toPesewas(reserved), total:toPesewas(total), paid:toPesewas(paid)
  });
  return {...result, due_date:result.newDebt ? debtDueDate(businessDate,profile.term_months) : null};
}
function initialCreditPreview(outstanding){
  return {...describeCredit({outstanding}),initial_estimate:true,enforcement_active:false,can_adjust_score:false};
}
// One bounded aggregate query for the displayed canonical customer IDs.
// Never calculate available credit from the truncated 500-receipt list.
async function loadDebtListCreditProfiles(db,{branchId,debts,enabled=false,enforcementActive=false}){
 if(!Number.isSafeInteger(branchId)||branchId<=0||!Array.isArray(debts)||debts.length>500)throw new RangeError("Invalid debt list scope");
 const ids=[...new Set(debts.map(d=>Number(d.customer_id)).filter(id=>Number.isSafeInteger(id)&&id>0))];
 const result={};
 for(const d of debts){
   const id=Number(d.id);
   if(!d.customer_id&&Number.isSafeInteger(id)&&id>0)result["legacy-"+id]=initialCreditPreview(d.balance);
 }
 if(!ids.length)return result;
 const marks=ids.map(()=>"?").join(",");
 const profileFields=enabled?",COALESCE(p.score,30) AS score,COALESCE(cs.term_months,1) AS term_months,COALESCE(r.reserved,0) AS reserved":"";
 const profileJoins=enabled?`LEFT JOIN customer_credit_profiles p ON p.customer_id=c.id
 LEFT JOIN customer_credit_settings cs ON cs.branch_id=c.branch_id
 LEFT JOIN (SELECT customer_id,branch_id,CAST(SUM(new_debt_pesewas)/100 AS DECIMAL(20,2)) AS reserved FROM customer_credit_approval_requests WHERE branch_id=? AND status='approved' AND expires_at>UTC_TIMESTAMP() GROUP BY customer_id,branch_id) r ON r.customer_id=c.id AND r.branch_id=c.branch_id`:"";
 const sql=`SELECT a.customer_id,a.outstanding,c.id AS canonical_id${profileFields}
 FROM (SELECT COALESCE(s.customer_id,d.customer_id) AS customer_id,COALESCE(SUM(CASE WHEN d.balance>0 THEN d.balance ELSE 0 END),0) AS outstanding
 FROM debts d LEFT JOIN sales s ON s.id=d.sale_id AND s.branch_id=d.branch_id
 WHERE d.branch_id=? AND COALESCE(s.customer_id,d.customer_id) IN (${marks})
 GROUP BY COALESCE(s.customer_id,d.customer_id)) a
 LEFT JOIN customers c ON c.id=a.customer_id AND c.branch_id=? ${profileJoins}`;
 const [rows]=await db.query(sql,[branchId,...ids,branchId,...(enabled?[branchId]:[])]);
 for(const row of rows){
   const key="customer-"+row.customer_id;
   result[key]=enabled&&row.canonical_id?{...describeCredit({score:Number(row.score),outstanding:row.outstanding,termMonths:Number(row.term_months),reserved:row.reserved}),enforcement_active:enforcementActive,can_adjust_score:false}:initialCreditPreview(row.outstanding);
 }
 return result;
}
async function readGraceDays(db,branchId){
 if(!Number.isSafeInteger(branchId)||branchId<=0)throw new RangeError("Invalid branch");
 const [rows]=await db.query("SELECT debt_reminder_days FROM settings WHERE branch_id=? ORDER BY id DESC LIMIT 1",[branchId]);
 const days=Number(rows[0]?.debt_reminder_days);
 return Number.isInteger(days)&&days>0&&days<=3650?days:30;
}
module.exports = {toPesewas, describeCredit, loadCreditProfile, assessPreparedSale,initialCreditPreview,loadDebtListCreditProfiles,readGraceDays};
