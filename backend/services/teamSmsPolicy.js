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
module.exports={MAX_BATCH,uniqueRecipients,fingerprint,chooseRecipients,messageText};
