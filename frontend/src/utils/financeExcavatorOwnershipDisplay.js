function asStage(stage){
  const labels={
    on_installment:"Under installment",
    sale_in_progress:"Sale in progress",
    sold:"Sold / paid",
    previous_sale:"Previous sale history",
    agreement_pending:"Agreement pending",
    application_pending:"Installment application pending",
    no_customer:"No buyer or application"
  };
  return labels[String(stage||"").toLowerCase()]||"Status unverified";
}
function isDelivered(summary){return String(summary?.delivery_status||"").toLowerCase()==="delivered";}
function customerEvidence(summary){
  if(!summary)return {status:"loading",heading:"Verifying customer records",subheading:"Checking agreements and applications"};
  const stage=String(summary.stage||"no_customer").toLowerCase();
  if(stage==="no_customer")return {status:"empty",heading:"No linked customer",subheading:"No buyer or installment applicant is recorded for this excavator"};
  return {
    status:stage,
    heading:asStage(stage),
    subheading:summary.customer_name||"Customer name not recorded",
    reference:summary.agreement_number||summary.application_number||null,
    detail:summary.agreement_status||summary.application_status||null,
  };
}
export {asStage,isDelivered,customerEvidence};
