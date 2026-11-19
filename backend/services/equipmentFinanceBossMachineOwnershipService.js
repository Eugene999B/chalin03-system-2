"use strict";
const {pool} = require("../config/db");
const {canApplySaleDiscount} = require("./saleDiscountAuthorizationService");
const ACTIVE_AGREEMENT_STATES=new Set(["active","due_soon","payment_due","overdue","defaulted"]);
const PENDING_AGREEMENT_STATES=new Set(["draft","pending_approval","approved"]);
const LIVE_APPLICATION_STATES=new Set(["draft","submitted","under_review","changes_requested","approved"]);
function positiveId(value){const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:null;}
function uniqueAssetIds(ids){return [...new Set((Array.isArray(ids)?ids:[]).map(positiveId).filter(Boolean))].slice(0,500);}
function agreementPriority(row){
 const state=String(row.agreement_status||"").toLowerCase();
 if(ACTIVE_AGREEMENT_STATES.has(state))return 3;
 if(state==="completed")return 2;
 if(PENDING_AGREEMENT_STATES.has(state))return 1;
 return 0;
}
function ownershipFromAgreement(row,asset){
 const state=String(row.agreement_status||"").toLowerCase();
 const saleType=String(row.sale_type||"").toLowerCase();
 const historical=String(asset?.sale_status||"").toLowerCase()==="available" && state==="completed";
 const life=ACTIVE_AGREEMENT_STATES.has(state)
   ?(saleType==="installment"?"on_installment":"sale_in_progress")
   :state==="completed"?(historical?"previous_sale":"sold")
   :"agreement_pending";
 return {
  stage:life,record_type:"agreement",customer_id:positiveId(row.customer_id),
  customer_name:String(row.customer_name_snapshot||row.customer_name||"").trim()||"Customer not recorded",
  customer_phone:String(row.customer_phone_snapshot||row.customer_phone||"").trim()||null,
  agreement_id:positiveId(row.id),agreement_number:row.agreement_number||null,
  agreement_status:state,sale_type:saleType,
  amount_paid:Number(row.amount_paid||0),outstanding_balance:Number(row.outstanding_balance||0),
  sale_price:Number(row.sale_price||0),
  ownership_status:row.ownership_status||null,
  delivery_status:row.delivery_status||null,
  application_id:null,application_number:null,application_status:null,
 };
}
function ownershipFromApplication(row){
 return {
  stage:"application_pending",record_type:"application",customer_id:positiveId(row.customer_id),
  customer_name:String(row.customer_name||"").trim()||"Customer not recorded",
  customer_phone:String(row.customer_phone||"").trim()||null,
  agreement_id:null,agreement_number:null,agreement_status:null,sale_type:null,
  amount_paid:null,outstanding_balance:null,sale_price:null,
  ownership_status:null,delivery_status:null,
  application_id:positiveId(row.id),application_number:row.application_number||null,
  application_status:row.application_status||null
 };
}
/** Buyer means a recorded agreement, applicant means a pending proposal. Never infer
 * ownership from sale_status, and never expose the customer to ordinary staff. */
function buildOwnershipSummary(assets,agreements=[],applications=[]){
 const assetById=new Map((assets||[]).map(asset=>[Number(asset.id),asset]));
 const map=new Map();
 for(const row of agreements){
  const id=Number(row.asset_id),asset=assetById.get(id);
  if(!asset||String(row.agreement_status||"").toLowerCase()==="cancelled")continue;
  const previous=map.get(id);
  if(!previous||agreementPriority(row)>agreementPriority(previous.row)){
   map.set(id,{row,priority:agreementPriority(row)});
  }
 }
 const applicationById=new Map();
 for(const row of applications){
  const id=Number(row.asset_id);
  if(!assetById.has(id)||!LIVE_APPLICATION_STATES.has(String(row.application_status||"").toLowerCase()))continue;
  if(!applicationById.has(id))applicationById.set(id,row);
 }
 return (assets||[]).map(asset=>{
  const id=Number(asset.id),agreement=map.get(id)?.row;
  const application=applicationById.get(id);
  const relationship=agreement
    ?ownershipFromAgreement(agreement,asset)
    :application?ownershipFromApplication(application):{
      stage:"no_customer",record_type:null,customer_id:null,customer_name:null,
      customer_phone:null,agreement_id:null,agreement_number:null,agreement_status:null,
      sale_type:null,amount_paid:null,outstanding_balance:null,sale_price:null,
      ownership_status:null,delivery_status:null,application_id:null,
      application_number:null,application_status:null
    };
  return {
    asset_id:id,asset_code:asset.asset_code,
    supplier_name:String(asset.supplier_name||"").trim()||null,
    acquisition_reference:String(asset.acquisition_reference||"").trim()||null,
    acquisition_date:asset.acquisition_date||null,
    acquisition_cost:Number(asset.acquisition_cost||0),
    physical_yard_id:positiveId(asset.hire_location_id),
    physical_yard_name:asset.location_name||null,
    sale_status:asset.sale_status||null,
    ...relationship
  };
 });
}
async function bossMachineOwnership({user,assetIds,connection=pool}){
 if(!(await canApplySaleDiscount(user,connection))){
  const e=new Error("Only the verified Boss or original System Administrator can view excavator buyer and supplier ownership.");
  e.statusCode=403;e.code="BOSS_MACHINE_OWNERSHIP_RESTRICTED";throw e;
 }
 const ids=uniqueAssetIds(assetIds);
 if(!ids.length)return [];
 const placeholders=ids.map(()=>"?").join(",");
 const [assets]=await connection.query(
  "SELECT asset.id,asset.asset_code,asset.supplier_name,asset.acquisition_reference,"+
  "asset.acquisition_date,asset.acquisition_cost,asset.hire_location_id,asset.sale_status,"+
  "location.name AS location_name FROM fleet_assets asset "+
  "LEFT JOIN business_locations location ON location.id=asset.hire_location_id "+
  "WHERE asset.id IN ("+placeholders+") AND asset.is_active=TRUE ORDER BY asset.id",ids);
 if(!assets.length)return [];
 const valid=assets.map(a=>a.id),marks=valid.map(()=>"?").join(",");
 const [agreements]=await connection.query(
  "SELECT agreement.id,agreement.asset_id,agreement.customer_id,agreement.agreement_number,"+
  "agreement.agreement_status,agreement.sale_type,agreement.customer_name_snapshot,"+
  "agreement.customer_phone_snapshot,agreement.sale_price,agreement.amount_paid,"+
  "agreement.outstanding_balance,agreement.ownership_status,agreement.delivery_status,"+
  "customer.customer_name,customer.phone AS customer_phone "+
  "FROM equipment_sale_agreements agreement "+
  "LEFT JOIN hire_customers customer ON customer.id=agreement.customer_id "+
  "WHERE agreement.asset_id IN ("+marks+") AND agreement.agreement_status<>'cancelled' "+
  "ORDER BY agreement.created_at DESC,agreement.id DESC",valid);
 const [applications]=await connection.query(
  "SELECT application.id,application.asset_id,application.customer_id,"+
  "application.application_number,application.application_status,"+
  "customer.customer_name,customer.phone AS customer_phone "+
  "FROM equipment_credit_applications application "+
  "LEFT JOIN hire_customers customer ON customer.id=application.customer_id "+
  "WHERE application.asset_id IN ("+marks+") "+
  "AND application.application_status IN ('draft','submitted','under_review','changes_requested','approved') "+
  "ORDER BY application.updated_at DESC,application.id DESC",valid);
 return buildOwnershipSummary(assets,agreements,applications);
}
module.exports={bossMachineOwnership,buildOwnershipSummary,uniqueAssetIds,ownershipFromAgreement};
