"use strict";

const PDFDocument = require("pdfkit");
const sharp = require("sharp");
const { findOfficialLogoPath } = require("./equipmentFinanceDocumentDesignV2Service");
const {
  normalizeStoredImage,
  loadPreferredAssetProtectedImage,
} = require("./equipmentFinanceProtectedImageService");

const C = Object.freeze({
  forest:"#07382B", deep:"#082B24", green:"#176D4A", mint:"#E9F5ED",
  gold:"#D6AC45", paleGold:"#F9F2DF", ink:"#182C29",
  muted:"#63756D", line:"#DCE5DF", bg:"#F5F8F5",
  white:"#FFFFFF", soft:"#EFF4F0", warning:"#946A22",
});
const A4 = Object.freeze({width:595.28,height:841.89,left:41.5,right:553.8});
const safe=(value,fallback="Not recorded",limit=280)=>
  String(value===null||value===undefined?"":value)
    .replace(/[\u0000-\u001F\u007F]+/g," ").trim().slice(0,limit)||fallback;
const money=value=>"GHS "+Number(value||0).toLocaleString("en-GH",{
  minimumFractionDigits:2,maximumFractionDigits:2,
});
function dateLabel(value){
  const d=new Date(value);
  if(!value||Number.isNaN(d.getTime()))return "Date not recorded";
  return new Intl.DateTimeFormat("en-GB",{
    timeZone:"Africa/Accra",day:"2-digit",month:"short",year:"numeric",
    hour:"2-digit",minute:"2-digit",hour12:false,
  }).format(d)+" GMT";
}
function trimNumber(value,limit=3){
  return Number.isFinite(Number(value))?Number(value).toFixed(limit):"-";
}
// PDFKit does not natively display WEBP. Convert both protected legacy photos
// and object-storage photos into a bounded, orientation-correct JPEG.
async function loadReadyCashExcavatorPhoto(receipt){
  let source=null;
  const snapshot=String(receipt.main_image_url_snapshot||"");
  if(snapshot && /^(?:data:image\/|bucket:\/\/)/i.test(snapshot)){
    try {
      source=await normalizeStoredImage(snapshot);
    }catch(error){
      console.warn("Ready Cash snapshot photo unavailable; trying protected machine image:",error.code||"INVALID_IMAGE");
    }
  }
  if(!source){
    try{
      source=await loadPreferredAssetProtectedImage(receipt.asset_id);
    }catch(error){
      if(!["FINANCE_PROTECTED_IMAGE_NOT_FOUND","FINANCE_PROTECTED_IMAGE_NOT_READABLE"].includes(error?.code)){
        console.warn("Ready Cash protected excavator image unavailable:",error?.code||"IMAGE_LOAD_FAILED");
      }
      return null;
    }
  }
  if(!source?.buffer?.length)return null;
  try{
    return await sharp(source.buffer,{failOn:"error",limitInputPixels:40e6,animated:false})
      .rotate()
      .resize({width:1200,height:900,fit:"inside",withoutEnlargement:true})
      .jpeg({quality:84,mozjpeg:true}).toBuffer();
  }catch(error){
    console.warn("Ready Cash photo conversion unavailable:",error?.code||"IMAGE_CONVERSION_FAILED");
    return null;
  }
}
function textAt(doc,value,x,y,width,opts={}){
  const {size=9,color=C.ink,font="Helvetica",align="left",
    max=140,tracking=0,ellipsis=true}=opts;
  const clean=safe(value,"—",max);
  doc.fillColor(color).font(font).fontSize(size);
  doc.text(clean,x,y,{
    width,align,lineBreak:false,ellipsis,characterSpacing:tracking,
  });
}
function label(doc,value,x,y,width,opts={}){
  textAt(doc,String(value).toUpperCase(),x,y,width,{
    size:7.1,color:C.muted,font:"Helvetica-Bold",tracking:0.45,...opts
  });
}
function line(doc,x1,y1,x2,y2,color=C.line,width=0.65){
  doc.moveTo(x1,y1).lineTo(x2,y2).lineWidth(width).strokeColor(color).stroke();
}
function fitted(doc,value,x,y,width,opts={}){
  const str=safe(value,"—",180);
  const font=opts.font||"Helvetica-Bold";
  let size=opts.size||12;
  doc.font(font);
  while(size>opts.minSize && doc.fontSize(size).widthOfString(str)>width)size-=0.5;
  textAt(doc,str,x,y,width,{...opts,size,font});
}
function card(doc,x,y,w,h,{fill=C.white,border=C.line,r=10}={}){
  doc.roundedRect(x,y,w,h,r).lineWidth(0.7).fillAndStroke(fill,border);
}
function fact(doc,name,value,x,y,w,{small=false}={}){
  label(doc,name,x,y,w);
  fitted(doc,value,x,y+13,w,{size:small?9.2:10.3,minSize:small?7.7:8.5});
}
function drawHeader(doc,receipt){
  doc.rect(0,0,A4.width,146).fill(C.deep);
  doc.rect(0,142,A4.width,4).fill(C.gold);
  doc.save().opacity(0.12).strokeColor(C.gold).lineWidth(0.6);
  for(let i=-65;i<665;i+=27){
    doc.moveTo(i,2).bezierCurveTo(i+50,45,i+8,95,i+76,143).stroke();
  }
  doc.restore();
  const logoPath=findOfficialLogoPath();
  let hasLogo=false;
  if(logoPath){
    try{
      doc.roundedRect(42,22,69,69,11).fill(C.white);
      doc.image(logoPath,47,27,{fit:[59,59],align:"center",valign:"center"});
      hasLogo=true;
    }catch{hasLogo=false;}
  }
  if(!hasLogo){
    doc.roundedRect(42,22,69,69,11).fill(C.gold);
    textAt(doc,"C03",47,42,59,{font:"Helvetica-Bold",size:23,color:C.deep,align:"center"});
  }
  textAt(doc,"CHALIN 03",126,26,350,{font:"Helvetica-Bold",size:25,color:C.white});
  textAt(doc,"COMPANY LIMITED  |  EQUIPMENT FINANCE",126,60,406,{
    font:"Helvetica-Bold",size:8.2,color:C.gold,tracking:0.6
  });
  textAt(doc,"Dunkwa Police Barrier, Ghana  •  0249469080 / 0249995510",
    126,78,420,{size:8,color:"#D8E6DC",max:120});
  textAt(doc,"OFFICIAL READY CASH RECEIPT",42,109,380,{
    font:"Helvetica-Bold",size:16.6,color:C.white,tracking:0.2
  });
  textAt(doc,"FULL PURCHASE • NO INSTALLMENTS",396,116,157,{
    font:"Helvetica-Bold",size:7.2,color:C.gold,align:"right"
  });
}
function drawStatus(doc,receipt){
  const x=A4.left,y=161,w=A4.right-x,h=61;
  card(doc,x,y,w,h,{fill:C.white});
  const columns=[
    ["PAYMENT STATUS","PAID IN FULL",C.green],
    ["DELIVERY / TITLE",receipt.ownership_status==="transferred"?"TRANSFERRED":"AWAITING HANDOVER",
      receipt.ownership_status==="transferred"?C.green:C.warning],
    ["RECEIPT ISSUED",dateLabel(receipt.payment_date),C.ink]
  ];
  const width=w/3;
  columns.forEach(([name,value,color],i)=>{
    const left=x+i*width;
    if(i)line(doc,left,y+10,left,y+h-10);
    label(doc,name,left+13,y+13,width-22,{size:6.9});
    fitted(doc,value,left+13,y+31,width-22,{
      font:"Helvetica-Bold",size:i===2?10.2:11.1,minSize:8,color
    });
  });
}
function drawExcavator(doc,receipt,photo){
  const left=A4.left,top=251,width=A4.right-left;
  label(doc,"01  /  THE EXCAVATOR",left,236,width,{
    color:C.green,size:8,tracking:0.9
  });
  const imageW=226,gap=13,detailX=left+imageW+gap,detailW=width-imageW-gap;
  card(doc,left,top,imageW,184,{fill:C.deep,border:C.deep});
  if(photo){
    try{
      doc.save();
      doc.roundedRect(left+7,top+7,imageW-14,142,7).clip();
      doc.rect(left+7,top+7,imageW-14,142).fill("#E0E8E1");
      doc.image(photo,left+7,top+7,{
        fit:[imageW-14,142],align:"center",valign:"center"
      });
      doc.restore();
    }catch(error){
      doc.restore();
      doc.roundedRect(left+7,top+7,imageW-14,142,7).fill("#E6EEEB");
      textAt(doc,"EXCAVATOR PHOTO UNAVAILABLE",left+20,top+68,imageW-40,{
        size:8.7,color:C.muted,font:"Helvetica-Bold",align:"center"
      });
    }
  }else{
    doc.roundedRect(left+7,top+7,imageW-14,142,7).fill("#E6EEEB");
    // No invented machine imagery. The user can see that this record lacks
    // a currently retrievable image, but the legitimate receipt still prints.
    doc.save().strokeColor(C.gold).lineWidth(1.3);
    doc.roundedRect(left+85,top+39,56,46,7).stroke();
    doc.circle(left+104,top+54,6).stroke();
    doc.moveTo(left+91,top+78).lineTo(left+108,top+65)
      .lineTo(left+120,top+74).lineTo(left+135,top+61).stroke();
    doc.restore();
    textAt(doc,"PHOTO NOT AVAILABLE",left+12,top+94,imageW-24,{
      size:9,color:C.deep,font:"Helvetica-Bold",align:"center"
    });
  }
  label(doc,photo?"REGISTERED EXCAVATOR PHOTO":"REGISTERED MACHINE",left+12,top+158,imageW-24,{
    color:C.gold,size:7,tracking:0.45
  });
  textAt(doc,"IDENTITY LINKED TO SALE RECORD",left+12,top+171,imageW-24,{
    color:"#BBD2C5",size:6.5
  });
  card(doc,detailX,top,detailW,184,{fill:C.white});
  label(doc,"MACHINE IDENTITY",detailX+14,top+14,detailW-28);
  fitted(doc,receipt.asset_name_snapshot,detailX+14,top+33,detailW-28,{
    font:"Helvetica-Bold",size:16,minSize:11.8
  });
  line(doc,detailX+14,top+61,detailX+detailW-14,top+61);
  fact(doc,"Asset code",receipt.asset_code_snapshot,detailX+14,top+74,detailW-28);
  fact(doc,"Make / model",
    [receipt.make_snapshot,receipt.model_snapshot].filter(Boolean).join(" / ")||"Not recorded",
    detailX+14,top+112,detailW-28,{small:true});
  fact(doc,"Serial number",receipt.serial_number_snapshot,detailX+14,top+148,detailW-28,{small:true});
}
function drawBuyerAndReferences(doc,receipt){
  const left=A4.left,top=469,width=A4.right-left,gap=13,w=(width-gap)/2;
  label(doc,"02  /  BUYER & RECORDS",left,452,width,{
    color:C.green,size:8,tracking:0.9
  });
  card(doc,left,top,w,111,{fill:C.white});
  label(doc,"REGISTERED BUYER",left+14,top+12,w-28);
  fitted(doc,receipt.customer_name_snapshot,left+14,top+29,w-28,{
    font:"Helvetica-Bold",size:13.3,minSize:9.5
  });
  fact(doc,"Telephone",receipt.customer_phone_snapshot,left+14,top+58,w-28,{small:true});
  textAt(doc,"Location: "+safe(receipt.customer_location_snapshot,"Not recorded",95),
    left+14,top+93,w-28,{size:8.2,color:C.muted,max:120});
  const x=left+w+gap;
  card(doc,x,top,w,111,{fill:C.white});
  fact(doc,"Receipt number",receipt.receipt_number,x+14,top+12,w-28,{small:true});
  fact(doc,"Sale agreement",receipt.agreement_number,x+14,top+51,w-28,{small:true});
  textAt(doc,"Recorded by: "+safe(receipt.received_by_name,"Authorized Finance staff",72),
    x+14,top+94,w-28,{size:8,color:C.muted,max:150});
}
function drawPayment(doc,receipt){
  const left=A4.left,width=A4.right-left,top=609;
  label(doc,"03  /  FINANCIAL SUMMARY",left,591,width,{
    color:C.green,size:8,tracking:0.9
  });
  card(doc,left,top,width,130,{fill:C.white});
  const inside=left+16;
  const rows=[
    ["Price before included tax",money(receipt.sale_price)],
    ["Included tax / levies",money(receipt.tax_amount)],
    ["Final agreed price",money(receipt.total_amount)],
  ];
  rows.forEach(([name,value],index)=>{
    const y=top+17+index*29;
    textAt(doc,name,inside,y,177,{size:index===2?9:8.7,color:index===2?C.ink:C.muted,
      font:index===2?"Helvetica-Bold":"Helvetica"});
    textAt(doc,value,inside+183,y,139,{size:index===2?10:9,
      font:index===2?"Helvetica-Bold":"Helvetica",align:"right"});
    if(index<2)line(doc,inside,y+21,inside+322,y+21,C.line,0.45);
  });
  const highlightX=left+344,highlightW=width-360;
  card(doc,highlightX,top+11,highlightW,108,{fill:C.forest,border:C.forest,r:9});
  label(doc,"AMOUNT RECEIVED",highlightX+11,top+26,highlightW-22,{
    color:C.gold,size:7,tracking:0.4
  });
  fitted(doc,money(receipt.amount),highlightX+10,top+51,highlightW-20,{
    color:C.white,size:16.5,minSize:10.5,align:"center"
  });
  textAt(doc,"BALANCE: "+money(receipt.outstanding_balance),
    highlightX+8,top+88,highlightW-16,{
      size:7.4,color:"#DDEDE4",font:"Helvetica-Bold",align:"center"
    });
  textAt(doc,"PAYMENT CONFIRMATION REFERENCE: "+
    safe(receipt.reference_number,"Not recorded",105),inside,top+111,317,{
      color:C.muted,size:7.4,max:160
    });
}
function drawNotes(doc,receipt){
  const left=A4.left,width=A4.right-left,top=750;
  card(doc,left,top,width,43,{fill:C.paleGold,border:"#EADBB7",r:8});
  textAt(doc,receipt.ownership_status==="transferred"?
    "FULLY PAID • SIGNED DELIVERY AND OWNERSHIP TRANSFER RECORDED":
    "FULLY PAID • MACHINE RESERVED PENDING SIGNED HANDOVER",
    left+14,top+8,width-28,{
      color:C.deep,size:9,font:"Helvetica-Bold",max:180
    });
  textAt(doc,"Payment was manually verified; this receipt does not initiate a gateway transfer. " +
    "For delivery or title, use the separately documented handover record.",
    left+14,top+24,width-28,{color:C.muted,size:7.0,max:230});
  line(doc,left,807,A4.right,807,C.gold,1.0);
  textAt(doc,"CHALIN 03 COMPANY LIMITED  •  EQUIPMENT FINANCE",
    left,815,315,{color:C.muted,size:7,font:"Helvetica-Bold"});
  textAt(doc,"Generated from recorded CHALIN03 transactions   •   1 / 1",
    351,815,202,{color:C.muted,size:7,align:"right"});
}
async function renderReadyCashReceiptPdf(receipt,{photo=null}={}){
  if(!receipt?.receipt_number||!receipt.agreement_number)
    throw new Error("Cannot issue receipt without the original recorded payment and agreement identifiers.");
  const doc=new PDFDocument({
    size:"A4",margin:0,autoFirstPage:true,bufferPages:false,compress:true,
    info:{
      Title:"CHALIN03 Official Ready Cash Receipt "+safe(receipt.receipt_number),
      Author:"CHALIN 03 COMPANY LIMITED",
      Subject:"Equipment Finance — complete payment receipt",
      Creator:"CHALIN03 Ready Cash",
    },
  });
  const chunks=[];
  return new Promise((resolve,reject)=>{
    doc.on("data",chunk=>chunks.push(chunk));
    doc.once("end",()=>resolve(Buffer.concat(chunks)));
    doc.once("error",reject);
    try{
      doc.rect(0,146,A4.width,A4.height-146).fill(C.bg);
      drawHeader(doc,receipt);
      drawStatus(doc,receipt);
      drawExcavator(doc,receipt,photo);
      drawBuyerAndReferences(doc,receipt);
      drawPayment(doc,receipt);
      drawNotes(doc,receipt);
      doc.end();
    }catch(error){doc.destroy(error);reject(error);}
  });
}
module.exports={
  loadReadyCashExcavatorPhoto,renderReadyCashReceiptPdf,dateLabel,money,
};
