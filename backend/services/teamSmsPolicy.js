"use strict";
const crypto=require("node:crypto");
const {validMobile,maskPhone}=require("./financeSmsCampaignService");
const MAX_BATCH=100;
function uniqueRecipients(rows){
 const seen=new Set(),recipients=[];let invalid=0,duplicates=0;
 for(const row of rows){
  const phone=validMobile(row.phone),id=Number(row.id);
  if(!phone||!Number.isSafeInteger(id)||id<=0){invalid++;continue;}
  if(seen.has(phone)){duplicates++;continue;}seen.add(phone);
  recipients.push({id,name:String(row.name||"Recipient").slice(0,150),phone,category:String(row.category||""),masked_phone:maskPhone(phone)});
 }
 return {recipients,invalid,duplicates};
}
function fingerprint(recipients,message){return crypto.createHash("sha256").update(JSON.stringify([recipients.map(r=>[r.id,r.phone]).sort((a,b)=>a[0]-b[0]),message])).digest("hex");}
function chooseRecipients(audience,mode,ids){
 if(mode==="all")return audience;
 if(mode!=="selected"||!Array.isArray(ids)||!ids.length||ids.some(id=>!Number.isSafeInteger(id)||id<=0))throw Error("Choose all or selected recipients");
 const chosen=new Set(ids),result=audience.filter(r=>chosen.has(r.id));
 if(result.length!==chosen.size)throw Error("Recipient selection has changed; refresh");
 return result;
}
function messageText(input){const message=typeof input==="string"?input.trim():"";if(!message||message.length>480)throw Error("Message must contain 1 to 480 characters");return message;}
function classifySubmissionError(error){
 const code=Number(error?.statusCode);
 const rejected=Number.isInteger(code)&&code>=400&&code<500&&![408,409,425,429].includes(code);
 const known={400:"Provider rejected the message or recipient.",401:"Provider authentication failed.",402:"Provider payment or SMS balance issue.",403:"Provider denied the request; check account and sender approval.",404:"Provider endpoint or resource unavailable.",422:"Provider rejected the message parameters."};
 const reason=rejected?(known[code]||"Provider rejected the submission (HTTP "+code+")."):"Provider outcome is uncertain. Check delivery history before retrying.";
 return {status:rejected?"failed":"delivery_unknown",reason,providerMessageId:error?.providerMessageId||null,providerStatus:rejected?String(code):null};
}
module.exports={MAX_BATCH,uniqueRecipients,fingerprint,chooseRecipients,messageText,classifySubmissionError};
