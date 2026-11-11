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
    const csvTable = (cols, records) => [
      cols.map(col=>csvValue(col.label)).join(","),
      ...records.map(record=>cols.map(col=>csvValue(record[col.key])).join(","))
    ].join("\r\n");
    // A single CSV cannot contain multiple worksheets: clearly label each
    // independent section instead of hiding returns, refunds or exceptions.
    const extras = sections.map(section =>
      "\r\n" + csvValue("SECTION: "+section.name) + "\r\n" +
      csvTable(section.columns,section.rows)
    ).join("\r\n");
    const result = "\uFEFF" + preamble + csvTable(columns,rows) + "\r\n" + extras + "\r\n";
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
    const renderWordTable = (name,cols,records) => {
      const headers=cols.map(col=>"<th>"+html(col.label)+"</th>").join("");
      const values=escapeRows(records,cols)
        .map(row=>"<tr>"+row.map(cell=>"<td>"+html(fmtNumber(cell))+"</td>").join("")+"</tr>").join("");
      return "<h2>"+html(name)+" ("+records.length+" records)</h2>" +
        "<table><thead><tr>"+headers+"</tr></thead><tbody>"+values+"</tbody></table>";
    };
    const result='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>'+html(title)+'</title>'+
      '<style>body{font-family:Calibri,Arial,sans-serif;color:#15342f;font-size:10pt}h1{font-size:23pt;color:#153b37}h2{font-size:14pt;page-break-after:avoid}p{color:#647672}table{border-collapse:collapse;width:100%;margin:14pt 0;table-layout:auto}th{background:#153b37;color:#fff;text-align:left}th,td{border:1px solid #dce7e5;padding:5pt;overflow-wrap:anywhere}tr:nth-child(even){background:#f3f8f6}thead{display:table-header-group}</style></head><body>'+
      '<h1>'+html(title)+'</h1><p>'+html(description || "")+'</p><table>'+metaRows+'</table>'+
      renderWordTable("Transaction Lines",columns,rows)+
      sections.map(section=>renderWordTable(section.name,section.columns,section.rows)).join("")+
      '<p>CHALIN03 controlled audit evidence. Return cost is a historical-weighted estimate, not proof of theft or a bank-settled refund.</p></body></html>';
    setHeaders(res,"application/msword; charset=utf-8",filename+".doc");
    return res.status(200).send(result);
  }
  if (mode === "pdf") {
    const recordCount = rows.length + sections.reduce((n,s)=>n+s.rows.length,0);
    // Guard the user against giant incomplete/slow browser PDF streams.
    // The workbook and CSV remain available for large date ranges.
    if(recordCount>9000)return res.status(422).json({status:"error",
      message:"PDF contains too many audit rows. Choose a shorter date range, or use the complete Excel/CSV download."});
    setHeaders(res,"application/pdf",filename+".pdf");
    const doc=new PDFDocument({size:"A4",layout:"landscape",margin:36,bufferPages:true});
    doc.pipe(res);
    doc.fillColor("#153B37").font("Helvetica-Bold").fontSize(18).text(title);
    doc.moveDown(.3).font("Helvetica").fontSize(9).fillColor("#536b64").text(description||"");
    doc.moveDown(.4).fontSize(8).fillColor("#153B37");
    meta.forEach(([a,b])=>doc.text(a+": "+fmtNumber(b),{lineGap:2}));
    doc.moveDown(.6);
    const usable=doc.page.width-72;
    function renderSection(name,cols,recs) {
      // Narrow, evidence-heavy sections are split into readable groups of
      // columns. Each group repeats the first source identifier so every page
      // can still be traced to its original transaction or return.
      const idCount=cols.length>9?2:0;
      const idCols=cols.slice(0,idCount);
      const remaining=cols.slice(idCount);
      const groups=remaining.length>9
        ? Array.from({length:Math.ceil(remaining.length/7)},(_,i)=>[
            ...idCols,...remaining.slice(i*7,(i+1)*7)])
        : [cols];
      for(let g=0;g<groups.length;g++) {
        const subset=groups[g];
        if(doc.y>doc.page.height-96)doc.addPage();
        doc.moveDown(.4);
        doc.font("Helvetica-Bold").fontSize(11).fillColor("#153B37")
          .text(name+" ("+recs.length+" records)"+
            (groups.length>1?" — columns "+(g+1)+"/"+groups.length:""));
        doc.moveDown(.2);
        const weights=subset.map(col=>Math.max(1,Number(col.weight||1)));
        const denom=weights.reduce((a,b)=>a+b,0);
        const splits=weights.map(w=>usable*w/denom);
        const widthEnough=splits.every(w=>w>22);
        const drawRow=(values,header=false)=>{
          const height=header?36:34;
          if(doc.y+height>doc.page.height-42) {
            doc.addPage();
            if(!header)drawRow(subset.map(col=>col.label),true);
          }
          const y=doc.y;
          doc.rect(36,y,usable,height).fill(header?"#153B37":(Math.floor(y/height)%2?"#F3F8F6":"#FFFFFF"));
          let x=36;
          doc.font(header?"Helvetica-Bold":"Helvetica").fontSize(widthEnough?7:6)
            .fillColor(header?"#FFFFFF":"#263C37");
          values.forEach((v,i)=>{
            doc.text(String(fmtNumber(v)).slice(0,130),x+3,y+5,{
              width:Math.max(12,splits[i]-6),height:height-8,ellipsis:true
            });
            x+=splits[i];
          });
          doc.y=y+height;
        };
        drawRow(subset.map(col=>col.label),true);
        for(const record of recs)drawRow(subset.map(col=>safeCell(record[col.key])));
      }
    }
    renderSection("Transaction Lines",columns,rows);
    for(const section of sections)renderSection(section.name,section.columns,section.rows);
    const pages=doc.bufferedPageRange();
    for(let k=pages.start;k<pages.start+pages.count;k++){
      doc.switchToPage(k);
      doc.fontSize(7).fillColor("#6B7975").text(
        "CHALIN03 • "+clean(branch)+" • Page "+(k+1)+" of "+pages.count,
        36,doc.page.height-25,{width:usable,align:"right"}
      );
    }
    doc.end();
    return;
  }
  return res.status(400).json({status:"error",message:"Choose Excel, PDF, Word or CSV."});
}
module.exports={sendAuditExport,safeCell,fileSlug};
