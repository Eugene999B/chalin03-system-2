"use strict";
/**
 * Native Office Open XML (DOCX) for board-level Spare Parts intelligence.
 * Uses the Node standard library for OOXML ZIP packaging; no runtime office
 * process, uploaded template, HTML-in-.doc wrapper or network dependency.
 * All values are sourced from the same protected report model as XLSX/PDF.
 */
const zlib=require("zlib");
const {renderBusinessChartPng}=require("./reportPresentationCharts");
function esc(value){
  return String(value??"").replace(/[^\x09\x0a\x0d\x20-\uD7FF\uE000-\uFFFD]/g," ")
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&apos;");
}
function textRun(value,opts={}){
  const props=[];
  if(opts.bold)props.push('<w:b/>');
  if(opts.color)props.push('<w:color w:val="'+opts.color+'"/>');
  if(opts.size)props.push('<w:sz w:val="'+Number(opts.size)*2+'"/>');
  return '<w:r><w:rPr>'+props.join("")+'</w:rPr><w:t xml:space="preserve">'+
    esc(value)+'</w:t></w:r>';
}
function p(value,style="Normal",options={}){
  const props=['<w:pStyle w:val="'+esc(style)+'"/>'];
  if(options.after!==undefined)props.push('<w:spacing w:after="'+Math.floor(options.after)+'"/>');
  if(options.align)props.push('<w:jc w:val="'+esc(options.align)+'"/>');
  if(options.keep)props.push('<w:keepNext/>');
  return '<w:p><w:pPr>'+props.join("")+'</w:pPr>'+
    textRun(value,{bold:options.bold,color:options.color,size:options.size})+'</w:p>';
}
function pageBreak(){
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}
function cell(value,header=false,shade=""){
  const background=shade|| (header?"103849":"FFFFFF");
  return '<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>'+
    '<w:shd w:fill="'+background+'"/><w:tcMar><w:top w:w="110" w:type="dxa"/>'+
    '<w:start w:w="110" w:type="dxa"/><w:bottom w:w="110" w:type="dxa"/>'+
    '<w:end w:w="110" w:type="dxa"/></w:tcMar></w:tcPr>'+
    '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>'+
    textRun(value,{bold:header,color:header?"FFFFFF":"21404A",size:header?9:9})+
    '</w:p></w:tc>';
}
function table(columns,records){
  if(!Array.isArray(columns)||!columns.length)return "";
  const grid=columns.map(()=>'<w:gridCol w:w="'+Math.floor(9650/columns.length)+'"/>').join("");
  const heading='<w:tr><w:trPr><w:tblHeader w:val="true"/></w:trPr>'+
    columns.map(col=>cell(col.label,true)).join("")+'</w:tr>';
  const body=(records||[]).map((row,index)=>{
    const shade=index%2===0?"F3F8F7":"FFFFFF";
    return '<w:tr><w:trPr><w:cantSplit/></w:trPr>'+
      columns.map(col=>cell(
        typeof row[col.key]==="number"
          ?row[col.key].toLocaleString("en-GH",{maximumFractionDigits:2})
          :String(row[col.key]??""),false,shade)).join("")+'</w:tr>';
  }).join("");
  return '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>'+
    '<w:tblLayout w:type="autofit"/><w:tblBorders>'+
    '<w:bottom w:val="single" w:sz="3" w:color="D7E6E3"/>'+
    '<w:insideH w:val="single" w:sz="2" w:color="DDEBE8"/>'+
    '</w:tblBorders></w:tblPr><w:tblGrid>'+grid+'</w:tblGrid>'+heading+body+'</w:tbl>';
}
function picture(id,rId,alt){
  const cx=6020000,cy=2528400;
  return '<w:p><w:pPr><w:spacing w:after="150"/></w:pPr><w:r><w:drawing>'+
    '<wp:inline distT="0" distB="0" distL="0" distR="0">'+
    '<wp:extent cx="'+cx+'" cy="'+cy+'"/>'+
    '<wp:docPr id="'+id+'" name="Source-backed chart '+id+'" descr="'+esc(alt)+'"/>'+
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'+
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="CHALIN03 report chart"/>'+
    '<pic:cNvPicPr/></pic:nvPicPr>'+
    '<pic:blipFill><a:blip r:embed="'+rId+'"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'+
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="'+cx+'" cy="'+cy+'"/></a:xfrm>'+
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'+
    '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
}
const STYLES='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
'<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'+
'<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/>'+
'<w:sz w:val="20"/><w:color w:val="23414B"/></w:rPr></w:rPrDefault></w:docDefaults>'+
[
["Normal",20,"27434E",false,130],
["ReportBrand",32,"0B6B64",true,150],
["CoverTitle",54,"123A46",true,220],
["CoverSubtitle",26,"557983",false,290],
["Title",37,"123A46",true,240],
["Heading1",27,"174450",true,200],
["Heading2",22,"0F6C66",true,125],
["Micro",16,"557F82",true,120],
["BodyNote",19,"657C83",false,150]
].map(([name,sz,color,bold,space])=>
  '<w:style w:type="paragraph" w:styleId="'+name+'"><w:name w:val="'+name+'"/>'+
  '<w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="'+sz+'"/>'+
  '<w:color w:val="'+color+'"/>'+(bold?'<w:b/>':'')+'</w:rPr>'+
  '<w:pPr><w:spacing w:after="'+space+'"/></w:pPr></w:style>'
).join("")+'</w:styles>';
function crc32(buffer){
  let crc=0xffffffff;
  for(const byte of buffer){
    crc^=byte;
    for(let i=0;i<8;i++)crc=(crc>>>1)^(0xedb88320&-(crc&1));
  }
  return (crc^0xffffffff)>>>0;
}
function zip(files){
  const local=[],central=[];let offset=0;
  for(const {name,data} of files){
    const raw=Buffer.isBuffer(data)?data:Buffer.from(data,"utf8");
    const nameBuffer=Buffer.from(name,"utf8");
    const packed=zlib.deflateRawSync(raw,{level:6});
    const crc=crc32(raw);
    const localHeader=Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50,0);
    localHeader.writeUInt16LE(20,4);localHeader.writeUInt16LE(0,6);
    localHeader.writeUInt16LE(8,8);
    localHeader.writeUInt32LE(crc,14);
    localHeader.writeUInt32LE(packed.length,18);
    localHeader.writeUInt32LE(raw.length,22);
    localHeader.writeUInt16LE(nameBuffer.length,26);
    local.push(localHeader,nameBuffer,packed);
    const centralHeader=Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50,0);
    centralHeader.writeUInt16LE(20,4);centralHeader.writeUInt16LE(20,6);
    centralHeader.writeUInt16LE(8,10);
    centralHeader.writeUInt32LE(crc,16);
    centralHeader.writeUInt32LE(packed.length,20);
    centralHeader.writeUInt32LE(raw.length,24);
    centralHeader.writeUInt16LE(nameBuffer.length,28);
    centralHeader.writeUInt32LE(offset,42);
    central.push(centralHeader,nameBuffer);
    offset+=localHeader.length+nameBuffer.length+packed.length;
  }
  const centralSize=central.reduce((n,b)=>n+b.length,0);
  const eocd=Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50,0);
  eocd.writeUInt16LE(files.length,8);eocd.writeUInt16LE(files.length,10);
  eocd.writeUInt32LE(centralSize,12);eocd.writeUInt32LE(offset,16);
  return Buffer.concat([...local,...central,eocd]);
}
async function buildManagementDocx({
  title,description,branch,period,generated,generatedBy,
  rows=[],columns=[],sections=[],charts=[],dashboardCards=[]
}={}){
  const body=[];
  body.push(p("CHALIN03", "ReportBrand"));
  body.push(p("SPARE PARTS  /  CONTROLLED MANAGEMENT EVIDENCE","Micro"));
  body.push(p(title,"CoverTitle"));
  body.push(p(description||"A review of original store records.","CoverSubtitle"));
  body.push(p("STORE   "+(branch||"Selected store"),"Heading2"));
  body.push(p("PERIOD   "+(period||"Current snapshot"),"Normal"));
  body.push(p("PREPARED   "+(generatedBy||"Authorised CHALIN03 user"),"Normal"));
  body.push(p("GENERATED   "+(generated||new Date().toISOString()),"BodyNote"));
  body.push(p("SALES    /    COLLECTIONS    /    DEBT    /    STOCK    /    AUDIT","Micro"));
  body.push(p("CONFIDENTIAL   •   INTERNAL DECISION SUPPORT","BodyNote"));
  body.push(pageBreak());

  body.push(p("01 / EXECUTIVE REPORT","Micro"));
  body.push(p("The business at a glance","Title"));
  if(dashboardCards.length)body.push(table([
    {key:"name",label:"Management indicator"},
    {key:"value",label:"Recorded value"},
    {key:"note",label:"Accounting context"}
  ],dashboardCards.map(card=>({name:card.label,value:card.value,note:card.note||""}))));
  body.push(p("Management interpretation","Heading1"));
  for(const [index,row] of rows.slice(0,15).entries()){
    body.push(p(String(index+1).padStart(2,"0")+"  /  "+
      (row.topic||row.heading||row[columns[0]?.key]||"Analysis"),"Heading2"));
    body.push(p(row.explanation||row.text||row[columns[1]?.key]||"","Normal"));
  }
  body.push(p("Accounting basis","Heading1"));
  body.push(p("Completed invoices are sale-date values. At-sale collections and later debt repayments use different events. Open debts, supplier balances and stock are current snapshots. Recorded receipts are not verified bank balances. Historical gross margin is not statutory net profit.","BodyNote"));
  if(charts.length)body.push(pageBreak());
  const files=[];
  const imageRelationships=[];
  for(const [index,chart] of charts.slice(0,7).entries()){
    const id=index+1,relationship="rId"+(id+2);
    body.push(p("02 / ANALYSIS CHARTS","Micro"));
    body.push(p(chart.title,"Heading1"));
    body.push(p(chart.note||chart.unit||"Original recorded evidence","BodyNote"));
    body.push(picture(id,relationship,chart.title));
    body.push(p("Source note: figures shown in GHS where applicable; detailed rows follow.","BodyNote"));
    body.push(pageBreak());
    files.push({name:"word/media/chart"+id+".png",data:await renderBusinessChartPng(chart)});
    imageRelationships.push('<Relationship Id="'+relationship+
      '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"'+
      ' Target="media/chart'+id+'.png"/>');
  }
  body.push(p("03 / SOURCE EVIDENCE","Micro"));
  body.push(p("Detailed records and reconciliations","Title"));
  const all=[{name:"Business Narrative",columns,rows},...sections];
  for(const section of all){
    body.push(p(section.name+"  /  "+(section.rows||[]).length+" records","Heading1"));
    if(section.columns?.length)body.push(table(section.columns,section.rows||[]));
    else body.push(p("No matching source records.","BodyNote"));
  }
  body.push(p("Prepared from read-only selected store evidence. Investigation flags are not proof of fraud. An accountant must validate any statutory financial conclusion.","BodyNote"));
  body.push('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'+
    '<w:pgMar w:top="1080" w:bottom="1000" w:left="1040" w:right="1040" '+
    'w:header="420" w:footer="420"/></w:sectPr>');
  const document='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'+
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'+
    ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"'+
    ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'+
    ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>'+
    body.join("")+'</w:body></w:document>';
  const contentTypes='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
    '<Default Extension="xml" ContentType="application/xml"/>'+
    '<Default Extension="png" ContentType="image/png"/>'+
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'+
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'+
    '</Types>';
  const rootRelationships='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  const wordRelationships='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'+
    imageRelationships.join("")+'</Relationships>';
  return zip([
    {name:"[Content_Types].xml",data:contentTypes},
    {name:"_rels/.rels",data:rootRelationships},
    {name:"word/document.xml",data:document},
    {name:"word/styles.xml",data:STYLES},
    {name:"word/_rels/document.xml.rels",data:wordRelationships},
    ...files
  ]);
}
module.exports={buildManagementDocx,esc,zip};
