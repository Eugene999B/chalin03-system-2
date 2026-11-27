"use strict";

// Reporting on explicit, reconciled owner allocations only. Amounts in pesewas.
// Never infer owner from customer names, nationality or a reduction percentage.
const OWNERS = Object.freeze(["chalin03","partner","unclassified"]);
const FIELDS = Object.freeze(["netRevenue","cost","receivable","collections"]);
function integer(v, label) {
  if (!Number.isSafeInteger(v)) throw new RangeError("Invalid " + label);
  return v;
}
function empty() {return {netRevenue:0,cost:0,receivable:0,collections:0};}
function plus(a,b) {
  for(const key of FIELDS) a[key]=integer(a[key]+integer(b[key],key),key);
}
function withProfit(v) {return {...v,grossProfit:integer(v.netRevenue-v.cost,"grossProfit")};}
function reconcileOwnershipReport({allocations,ledgerTotals}) {
  if (!Array.isArray(allocations) || !ledgerTotals) throw new TypeError("Verified ledger allocations and totals are required");
  const groups=Object.fromEntries(OWNERS.map(owner=>[owner,empty()]));
  const seen=new Set();
  for (const row of allocations) {
    if (typeof row.allocationId!=="string" || !row.allocationId.trim() || seen.has(row.allocationId)) throw new Error("Missing or duplicate allocation identifier");
    seen.add(row.allocationId);
    if (!OWNERS.includes(row.owner)) throw new Error("Invalid owner classification");
    // Partner and own classifications require explicit verified source reference.
    if (row.owner!=="unclassified" && (typeof row.evidenceRef!=="string" || !row.evidenceRef.trim())) throw new Error("Ownership evidence required");
    plus(groups[row.owner],row);
  }
  const full=empty();
  for(const owner of OWNERS) plus(full,groups[owner]);
  for(const key of FIELDS) if(full[key]!==integer(ledgerTotals[key],key)) throw new Error("Ledger reconciliation failed: "+key);
  return {scope:"ownership_reconciliation", full:withProfit(full),
    groups:Object.fromEntries(OWNERS.map(owner=>[owner,withProfit(groups[owner])])),
    reconciliationRequired:allocations.some(row=>row.owner==="unclassified")};
}
module.exports={reconcileOwnershipReport};
