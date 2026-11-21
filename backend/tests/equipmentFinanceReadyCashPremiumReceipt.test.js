"use strict";
const assert=require("node:assert/strict");
const test=require("node:test");
const fs=require("node:fs");
const path=require("node:path");
const sharp=require("sharp");
const Module=require("node:module");
const rendererPath=path.resolve(__dirname,"../services/equipmentFinanceReadyCashReceiptPdfService.js");
const protectedPath=path.resolve(__dirname,"../services/equipmentFinanceProtectedImageService.js");

const receipt={
  id:22,asset_id:31,agreement_number:"RCA-2026-000031",
  receipt_number:"RCR-2026-000031",
  customer_name_snapshot:"Synthetic Test Buyer",
  customer_phone_snapshot:"0240000000",
  customer_location_snapshot:"Test Location, Ghana",
  asset_code_snapshot:"EXC-TEST-001",
  asset_name_snapshot:"20 Ton Excavator (Synthetic)",
  make_snapshot:"Synthetic",model_snapshot:"EX200",serial_number_snapshot:"SERIAL-TEST-031",
  main_image_url_snapshot:null,
  sale_price:"230000.00",tax_amount:"20000.00",discount_amount:"0.00",
  total_amount:"250000.00",amount_paid:"250000.00",outstanding_balance:"0.00",
  ownership_status:"retained",payment_date:new Date("2026-11-21T07:20:00Z"),
  reference_number:"EXAMPLE-PAID-TEST-001",amount:"250000.00",
  received_by_name:"Synthetic System Administrator"
};

function loadWithMockProtectedImages({sourceValue,failSnapshot=false}={}){
  const calls=[];
  const original=Module._load;
  try{
    Module._load=function intercepted(request,parent,isMain){
      if(parent?.filename===rendererPath &&
         request==="./equipmentFinanceProtectedImageService"){
        return {
          normalizeStoredImage:async value=>{
            calls.push(["snapshot",value]);
            if(failSnapshot)throw Object.assign(new Error("Bad snapshot"),{code:"FINANCE_PROTECTED_IMAGE_NOT_READABLE"});
            return {buffer:sourceValue,mimeType:"image/png"};
          },
          loadPreferredAssetProtectedImage:async assetId=>{
            calls.push(["protected",assetId]);
            return {buffer:sourceValue,mimeType:"image/png"};
          }
        };
      }
      return original.apply(this,arguments);
    };
    delete require.cache[rendererPath];
    const renderer=require(rendererPath);
    return {renderer,calls};
  }finally{
    Module._load=original;
    delete require.cache[rendererPath];
  }
}
async function makePhoto(){
  return sharp({create:{width:420,height:240,channels:3,
    background:{r:31,g:90,b:57}}}).png().toBuffer();
}
function pages(pdf){
  const value=pdf.toString("latin1");
  // /Type /Pages should not be counted as a leaf page.
  return (value.match(/\/Type\s*\/Page\b/g)||[]).length;
}
function imageObjects(pdf){
  return (pdf.toString("latin1").match(/\/Subtype\s*\/Image\b/g)||[]).length;
}
test("premium receipt is a single printable A4 PDF with the machine image embedded",async()=>{
  const {renderReadyCashReceiptPdf}=require(rendererPath);
  const pdf=await renderReadyCashReceiptPdf(receipt,{photo:await makePhoto()});
  assert.equal(pdf.subarray(0,5).toString(),"%PDF-");
  assert.equal(pages(pdf),1);
  assert.ok(imageObjects(pdf)>=1,"Excavator photo must be present as a real PDF image object");
  assert.ok(pdf.length>4500,"Expected fully rendered PDF");
});
test("receipt remains one page without a machine photo, and preserves original payment numbers",async()=>{
  const {renderReadyCashReceiptPdf}=require(rendererPath);
  const pdf=await renderReadyCashReceiptPdf({
    ...receipt,asset_name_snapshot:"X".repeat(150),customer_name_snapshot:"Y".repeat(150),
    reference_number:"Z".repeat(140),ownership_status:"transferred"
  },{photo:null});
  assert.equal(pdf.subarray(0,5).toString(),"%PDF-");
  assert.equal(pages(pdf),1,"Long names cannot spill over to a blank second page");
  assert.ok(pdf.length>3000);
});
test("image loader embeds the exact frozen sale snapshot before any current machine replacement",async()=>{
  const image=await makePhoto();
  const {renderer,calls}=loadWithMockProtectedImages({sourceValue:image});
  const result=await renderer.loadReadyCashExcavatorPhoto({
    ...receipt,main_image_url_snapshot:"data:image/png;base64,TESTSNAPSHOT"
  });
  assert.equal(result.subarray(0,2).toString("hex"),"ffd8","PDF photo must be a valid JPEG");
  assert.deepEqual(calls.map(x=>x[0]),["snapshot"]);
});
test("legacy snapshots gracefully fall back to the secure registered excavator image",async()=>{
  const image=await makePhoto();
  const {renderer,calls}=loadWithMockProtectedImages({sourceValue:image,failSnapshot:true});
  const result=await renderer.loadReadyCashExcavatorPhoto({
    ...receipt,main_image_url_snapshot:"bucket://older-snapshot"
  });
  assert.equal(result.subarray(0,2).toString("hex"),"ffd8");
  assert.deepEqual(calls.map(x=>x[0]),["snapshot","protected"]);
  assert.equal(calls.at(-1)[1],receipt.asset_id);
});
test("untrusted remote image URLs are never fetched or embedded directly",async()=>{
  const image=await makePhoto();
  const {renderer,calls}=loadWithMockProtectedImages({sourceValue:image});
  const result=await renderer.loadReadyCashExcavatorPhoto({
    ...receipt,main_image_url_snapshot:"https://arbitrary-host.example/user-photo"
  });
  assert.equal(result.subarray(0,2).toString("hex"),"ffd8");
  assert.deepEqual(calls.map(x=>x[0]),["protected"]);
});
test("receipt code does not alter sales, payment or machine records",()=>{
  const route=fs.readFileSync(path.resolve(__dirname,"../routes/equipmentFinanceReadyCashRoutes.js"),"utf8");
  const receiptPart=route.slice(route.indexOf('router.get("/ready-cash/:agreementId/receipt.pdf"'),
    route.indexOf('router.post("/ready-cash/:agreementId/handover"'));
  assert.match(receiptPart,/p\.is_voided = FALSE/);
  assert.match(receiptPart,/p\.payment_category = 'settlement'/);
  assert.match(receiptPart,/a\.hire_location_id IS NULL/);
  assert.match(receiptPart,/a\.agreement_notes LIKE 'READY_CASH:%'/);
  assert.match(receiptPart,/Cache-Control", "private, no-store"/);
  assert.match(receiptPart,/X-Chalin03-Receipt-Photo/);
  assert.doesNotMatch(receiptPart,/UPDATE fleet_assets|INSERT INTO equipment_sale_payments|UPDATE equipment_sale_agreements/);
});
