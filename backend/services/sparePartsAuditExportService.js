"use strict";
const ExcelJS = require("./excelJsCompat");
const PDFDocument = require("pdfkit");

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}
function safeCell(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const v = clean(value);
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}
function html(value) {
  return clean(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function csvValue(value) {
  const val = String(safeCell(value)).replace(/"/g, '""');
  return '"' + val + '"';
}
function fmtNumber(value) {
  return typeof value === "number" ? value.toLocaleString("en-GH", {maximumFractionDigits: 2}) : clean(value);
}
function fileSlug(value) {
  return clean(value).replace(/[^a-z0-9_-]+/gi, "-").slice(0, 90);
}
function setHeaders(res, type, name) {
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Disposition", 'attachment; filename="' + fileSlug(name) + '"');
  res.setHeader("Cache-Control", "private, no-store");
}
function escapeRows(rows, columns) {
  return rows.map((r) => columns.map((c) => safeCell(r[c.key])));
}
async function sendAuditExport(res, config) {
  const { format = "xlsx", title, description, period, branch, generatedBy, columns,
    rows, metrics = [], filename = "chalin03-audit", sections = [], fromDate, toDate } = config;
  const mode = String(format).toLowerCase();
  const showDateRange = fromDate !== undefined || toDate !== undefined;
  const startLabel = fromDate || "Earliest available";
  const endLabel = toDate || "Latest available";
  const data = escapeRows(rows, columns);
  const date = new Date().toISOString().replace("T"," ").slice(0,19) + " UTC";
  const meta = [
    ["Report", title], ["Purpose", description || ""], ["Selected store", branch],
    ["Period", period || "Current snapshot"],
    ...(showDateRange ? [["From Date", startLabel], ["To Date", endLabel]] : []),
    ["Generated", date],
    ["Prepared by", generatedBy || "CHALIN03 authorised staff"], ["Detail records", rows.length],
    ...metrics,
  ];
  if (mode === "csv") {
    setHeaders(res, "text/csv; charset=utf-8", filename + ".csv");
    const preamble = showDateRange
      ? [["Report", title], ["From Date", startLabel], ["To Date", endLabel],
          ["Selected store", branch], ["Generated", date]]
          .map(([label, value]) => [csvValue(label), csvValue(value)].join(",")).join("\r\n") + "\r\n\r\n"
      : "";
    const result = "\uFEFF" + preamble + columns.map(x=>csvValue(x.label)).join(",") + "\r\n" +
      data.map(row => row.map(csvValue).join(",")).join("\r\n") + "\r\n";
    return res.status(200).send(result);
  }
  if (mode === "xlsx") {
    const book = new ExcelJS.Workbook();
    book.creator = "CHALIN03 Audit Centre";
    book.created = new Date();
    const cover = book.addWorksheet("Executive Summary");
    cover.columns = [{header:"Measure",key:"measure",width:39},{header:"Value",key:"value",width:50}];
    meta.forEach(([measure,value])=>cover.addRow({measure:safeCell(measure),value:safeCell(value)}));
    const addTable = (name, cols, recs) => {
      const sheet = book.addWorksheet(name.slice(0,31));
      sheet.columns = cols.map(c => ({key:c.key,width:Math.max(14,Math.min(43,c.label.length+8))}));
      if (showDateRange) {
        sheet.addRow([title]);
        sheet.mergeCells(1,1,1,cols.length);
        sheet.getRow(1).font = {bold:true,size:15,color:{argb:"FF133B37"}};
        sheet.getRow(1).height = 30;
        sheet.addRow(["From Date",startLabel,"To Date",endLabel]);
        sheet.addRow(["Selected store",branch,"Generated",date]);
        sheet.addRow([]);
        sheet.getRow(2).font = {bold:true,color:{argb:"FF133B37"}};
        sheet.getRow(3).font = {color:{argb:"FF3F6259"}};
      }
      const headerRow = showDateRange ? 5 : 1;
      sheet.addRow(cols.map(c=>c.label));
      recs.forEach(row=>{const safe={};cols.forEach(c=>safe[c.key]=safeCell(row[c.key]));sheet.addRow(safe)});
      sheet.views=[{state:"frozen",ySplit:headerRow}];
      sheet.autoFilter = {from:{row:headerRow,column:1},to:{row:Math.max(headerRow,headerRow+recs.length),column:cols.length}};
      sheet.getRow(headerRow).font={bold:true,color:{argb:"FFFFFFFF"}};
      sheet.getRow(headerRow).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF133B37"}};
      sheet.getRow(headerRow).height=27;
      sheet.getRow(headerRow).alignment={vertical:"middle",wrapText:true};
      for(let i=headerRow+1;i<=headerRow+recs.length;i++) {
        if((i-headerRow)%2===0) sheet.getRow(i).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFF0F7F5"}};
      }
    };
    cover.getRow(1).font={bold:true,color:{argb:"FFFFFFFF"}};
    cover.getRow(1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF133B37"}};
    addTable("Transaction Lines",columns,rows);
    sections.forEach(s=>addTable(s.name,s.columns,s.rows));
    const buffer=await book.xlsx.writeBuffer();
    setHeaders(res,"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",filename+".xlsx");
    return res.status(200).send(Buffer.from(buffer));
  }
  if (mode === "doc" || mode === "word") {
    const metaRows=meta.map(([a,b])=>"<tr><th>"+html(a)+"</th><td>"+html(fmtNumber(b))+"</td></tr>").join("");
    const headers=columns.map(c=>"<th>"+html(c.label)+"</th>").join("");
    const allRows=data.map(row=>"<tr>"+row.map(cell=>"<td>"+html(fmtNumber(cell))+"</td>").join("")+"</tr>").join("");
    const result='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>'+html(title)+'</title>'+
      '<style>body{font-family:Calibri,Arial,sans-serif;color:#15342f;font-size:10pt}h1{font-size:23pt;color:#153b37}h2{font-size:14pt}p{color:#647672}table{border-collapse:collapse;width:100%;margin:14pt 0}th{background:#153b37;color:#fff;text-align:left}th,td{border:1px solid #dce7e5;padding:5pt}tr:nth-child(even){background:#f3f8f6}thead{display:table-header-group}</style></head><body>'+
      '<h1>'+html(title)+'</h1><p>'+html(description || "")+'</p><table>'+metaRows+'</table><h2>Transaction and evidence details</h2><table><thead><tr>'+headers+'</tr></thead><tbody>'+allRows+'</tbody></table>'+
      '<p>CHALIN03 controlled audit evidence. A physical variance is not, by itself, proof of theft.</p></body></html>';
    setHeaders(res,"application/msword; charset=utf-8",filename+".doc");
    return res.status(200).send(result);
  }
  if (mode === "pdf") {
    setHeaders(res,"application/pdf",filename+".pdf");
    const doc=new PDFDocument({size:"A4",layout:"landscape",margin:36,bufferPages:true});
    doc.pipe(res);
    doc.fillColor("#153B37").font("Helvetica-Bold").fontSize(19).text(title);
    doc.moveDown(.2).font("Helvetica").fontSize(9).fillColor("#536b64").text(description||"");
    doc.moveDown(.3).fontSize(8).fillColor("#153B37");
    meta.forEach(([a,b])=>doc.text(a+": "+fmtNumber(b),{lineGap:2}));
    doc.moveDown(.6);
    const usable=doc.page.width-72;
    const widths=columns.map(c=>Math.max(1,Number(c.weight||1)));
    const total=widths.reduce((n,v)=>n+v,0);
    const splits=widths.map(w=>usable*w/total);
    const drawRow=(arr,header=false)=>{
      const height=34;
      if(doc.y+height>doc.page.height-42){doc.addPage();if(!header)drawRow(columns.map(c=>c.label),true)}
      const yy=doc.y,x0=36;
      doc.rect(x0,yy,usable,height).fill(header?"#153B37":(Math.floor(yy/height)%2?"#F3F8F6":"#FFFFFF"));
      let xx=x0;doc.font(header?"Helvetica-Bold":"Helvetica").fontSize(7).fillColor(header?"#FFFFFF":"#263C37");
      arr.forEach((t,j)=>{doc.text(String(fmtNumber(t)).slice(0,145),xx+4,yy+5,{width:splits[j]-8,height:height-9,ellipsis:true});xx+=splits[j]});
      doc.y=yy+height;
    };
    drawRow(columns.map(c=>c.label),true);
    data.forEach(row=>drawRow(row));
    const pages=doc.bufferedPageRange();
    for(let k=pages.start;k<pages.start+pages.count;k++){
      doc.switchToPage(k);
      doc.fontSize(7).fillColor("#6B7975").text("CHALIN03 • "+html(branch)+" • Page "+(k+1)+" of "+pages.count,36,doc.page.height-25,{width:usable,align:"right"});
    }
    doc.end();
    return;
  }
  return res.status(400).json({status:"error",message:"Choose Excel, PDF, Word or CSV."});
}
module.exports={sendAuditExport,safeCell,fileSlug};
