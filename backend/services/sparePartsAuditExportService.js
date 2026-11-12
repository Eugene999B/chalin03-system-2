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
    book.lastModifiedBy = "CHALIN03 Audit Centre";
    book.subject = "Controlled Spare Parts operational and financial evidence";
    book.title = clean(title);
    book.created = new Date();

    const COLOR = {
      navy: "FF142C3E", navy2: "FF203E53", teal: "FF087F75",
      tealLight: "FFEAF6F2", blueLight: "FFF0F5FA", white: "FFFFFFFF",
      ink: "FF1A2C38", muted: "FF627687", border: "FFDCE6EA",
      gold: "FFE8BA5C", red: "FFAC3644", redLight: "FFFDEDEE",
      amber: "FFF8E7C5", stripe: "FFF6F9FC", green: "FF147C55"
    };
    const fill = color => ({ type: "pattern", pattern: "solid", fgColor: { argb: color } });
    const moneyFormat = '#,##0.00;[Red](#,##0.00);"-"';
    const countFormat = '#,##0;[Red](#,##0);"-"';
    const percentFormat = '0.0"%"';
    const transactionReport = sections.some(section => section.name === "Receipt Reconciliation");
    const metricMap = new Map(metrics.map(([name, value]) => [String(name), value]));
    const indicator = (name, label, note, isMoney, tone = COLOR.teal) => ({
      label, value: metricMap.has(name) ? metricMap.get(name) : "—", note, isMoney, tone
    });
    const cards = transactionReport ? [
      indicator("Active completed sale receipts", "COMPLETED RECEIPTS", "Recorded active sales", false),
      indicator("Full receipt totals INCLUDING tax (GHS)", "RECEIPT VALUE • GHS", "Includes recorded tax", true),
      indicator("Total MONEY REFUNDED (GHS)", "REFUNDS OUT • GHS", "Actual recorded refunds", true, COLOR.red),
      indicator("Number of return events (returned-at date)", "RETURN EVENTS", "By return date", false),
      indicator("Reconstructed customer receipts IN minus refunds OUT (GHS)", "NET COLLECTIONS • GHS", "Reconstructed cash movement", true),
      indicator("Total currently-active operating expenses (GHS)", "OPERATING EXPENSES • GHS", "Excludes voids and reversals", true),
      indicator("Indicative margin bridge AFTER returns and expenses (GHS)", "MARGIN BRIDGE • GHS", "Indicative, not audited net profit", true, COLOR.navy2),
      indicator("Issues needing investigation", "REVIEW EXCEPTIONS", "Investigate source records", false, COLOR.red)
    ] : [
      { label: "DETAIL RECORDS", value: rows.length, note: "Source rows", isMoney: false, tone: COLOR.teal },
      { label: "ADDITIONAL SECTIONS", value: sections.length, note: "Supporting worksheets", isMoney: false, tone: COLOR.navy2 },
      { label: "FROM DATE", value: startLabel, note: "Reporting period", isMoney: false, tone: COLOR.teal },
      { label: "TO DATE", value: endLabel, note: "Reporting period", isMoney: false, tone: COLOR.navy2 }
    ];

    const cover = book.addWorksheet("Executive Summary", {
      properties: { tabColor: { argb: COLOR.gold }, defaultRowHeight: 22 },
      views: [{ state: "frozen", ySplit: 4 }],
      pageSetup: {
        paperSize: 9, orientation: "landscape", fitToPage: true,
        fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.35, right: 0.35, top: 0.55, bottom: 0.55, header: 0.2, footer: 0.2 }
      }
    });
    cover.columns = Array.from({ length: 8 }, (_, i) => ({
      key: "dashboard_" + (i + 1), width: 18
    }));
    cover.headerFooter.oddFooter = "&LCHALIN03 • Controlled report&CInternal business evidence&RPage &P of &N";
    function band(row, message, background = COLOR.navy, foreground = COLOR.white) {
      cover.mergeCells(row, 1, row, 8);
      const cell = cover.getCell(row, 1);
      cell.value = safeCell(message);
      cell.fill = fill(background);
      cell.font = { name: "Aptos", size: 11, bold: true, color: { argb: foreground } };
      cell.alignment = { vertical: "middle", indent: 1 };
      cover.getRow(row).height = 29;
    }
    band(1, "CHALIN03  /  SPARE PARTS  /  EXECUTIVE REPORT");
    cover.mergeCells("A2:H2");
    cover.getCell("A2").value = safeCell(title);
    cover.getCell("A2").font = { name: "Aptos Display", size: 17, bold: true, color: { argb: COLOR.navy } };
    cover.getCell("A2").alignment = { vertical: "middle", indent: 1, wrapText: true };
    cover.getRow(2).height = 40;
    cover.mergeCells("A3:H3");
    cover.getCell("A3").value = "STORE: " + clean(branch) + "   |   PERIOD: " + clean(period || "Current snapshot") + "   |   CURRENCY: GHS";
    cover.getCell("A3").font = { size: 10, color: { argb: COLOR.muted } };
    cover.getCell("A3").alignment = { vertical: "middle", indent: 1, wrapText: true };
    cover.getRow(3).height = 29;
    cover.getRow(4).height = 12;
    band(5, "01  /  PERFORMANCE AT A GLANCE", COLOR.navy2);

    cards.forEach((card, index) => {
      const column = (index % 4) * 2 + 1;
      const topRow = 6 + Math.floor(index / 4) * 4;
      for (const row of [topRow, topRow + 1, topRow + 2]) {
        cover.mergeCells(row, column, row, column + 1);
      }
      const head = cover.getCell(topRow, column);
      const value = cover.getCell(topRow + 1, column);
      const foot = cover.getCell(topRow + 2, column);
      head.value = safeCell(card.label);
      head.fill = fill(COLOR.blueLight);
      head.font = { name: "Aptos", bold: true, size: 9, color: { argb: COLOR.navy2 } };
      head.alignment = { indent: 1, vertical: "middle" };
      value.value = safeCell(card.value);
      value.fill = fill(COLOR.blueLight);
      value.font = { name: "Aptos Display", bold: true, size: 17, color: { argb: card.tone } };
      value.alignment = { indent: 1, vertical: "middle", shrinkToFit: true };
      if (typeof card.value === "number") value.numFmt = card.isMoney ? moneyFormat : countFormat;
      foot.value = safeCell(card.note);
      foot.fill = fill(COLOR.blueLight);
      foot.font = { name: "Aptos", italic: true, size: 9, color: { argb: COLOR.muted } };
      foot.alignment = { indent: 1, vertical: "middle", shrinkToFit: true };
      cover.getRow(topRow).height = 22;
      cover.getRow(topRow + 1).height = 37;
      cover.getRow(topRow + 2).height = 22;
    });
    const detailsBandRow = transactionReport ? 14 : 10;
    band(detailsBandRow, "02  /  REPORT INFORMATION", COLOR.navy2);
    let cursor = detailsBandRow + 1;
    const metadataLabels = new Set(["Report", "Purpose", "Selected store", "Period",
      "From Date", "To Date", "Generated", "Prepared by", "Detail records"]);
    for (const [key, value] of meta.filter(([label]) => metadataLabels.has(label))) {
      cover.mergeCells(cursor, 1, cursor, 2);
      cover.mergeCells(cursor, 3, cursor, 8);
      const left = cover.getCell(cursor, 1);
      const right = cover.getCell(cursor, 3);
      left.value = safeCell(key);
      right.value = safeCell(value);
      left.font = { name: "Aptos", bold: true, size: 10, color: { argb: COLOR.navy } };
      right.font = { name: "Aptos", size: 10, color: { argb: COLOR.ink } };
      left.fill = fill(cursor % 2 ? COLOR.white : COLOR.stripe);
      right.fill = fill(cursor % 2 ? COLOR.white : COLOR.stripe);
      left.alignment = { indent: 1, vertical: "middle" };
      right.alignment = { indent: 1, vertical: "middle", wrapText: true };
      cover.getRow(cursor).height = key === "Purpose" ? 42 : 25;
      cursor += 1;
    }
    cursor += 1;
    band(cursor++, "03  /  FINANCIAL AND CONTROL INDICATORS", COLOR.navy2);
    cover.mergeCells(cursor, 1, cursor, 6);
    cover.mergeCells(cursor, 7, cursor, 8);
    cover.getCell(cursor, 1).value = "INDICATOR / ACCOUNTING BASIS";
    cover.getCell(cursor, 7).value = "RECORDED VALUE";
    for (const column of [1, 7]) {
      const cell = cover.getCell(cursor, column);
      cell.fill = fill(COLOR.teal);
      cell.font = { bold: true, color: { argb: COLOR.white }, size: 10 };
      cell.alignment = { indent: 1, vertical: "middle" };
    }
    cover.getRow(cursor++).height = 28;
    const firstMetricRow = cursor;
    let previousGroup = "";
    for (const [name, rawValue] of metrics) {
      const label = String(name);
      const metricGroup = !transactionReport ? "" :
        /return|refund/i.test(label) ? "RETURNS & REFUNDS" :
        /expense|margin bridge/i.test(label) ? "EXPENSES & MARGIN CONTEXT" :
        /allocation|collection|paid|tender|original channel|unknown|investigation|issues/i.test(label) ? "COLLECTIONS & AUDIT CONTROLS" :
        "SALES & RECEIPT RECONCILIATION";
      if (metricGroup && metricGroup !== previousGroup) {
        cover.mergeCells(cursor, 1, cursor, 8);
        const groupCell = cover.getCell(cursor, 1);
        groupCell.value = metricGroup;
        groupCell.fill = fill(COLOR.tealLight);
        groupCell.font = { name: "Aptos", bold: true, size: 9, color: { argb: COLOR.teal } };
        groupCell.alignment = { indent: 1, vertical: "middle" };
        cover.getRow(cursor).height = 22;
        cursor += 1;
        previousGroup = metricGroup;
      }
      cover.mergeCells(cursor, 1, cursor, 6);
      cover.mergeCells(cursor, 7, cursor, 8);
      const measureCell = cover.getCell(cursor, 1);
      const valueCell = cover.getCell(cursor, 7);
      measureCell.value = safeCell(label);
      valueCell.value = safeCell(rawValue);
      const alternate = (cursor - firstMetricRow) % 2 === 0;
      const background = alternate ? COLOR.white : COLOR.stripe;
      measureCell.fill = fill(background);
      valueCell.fill = fill(background);
      measureCell.font = { name: "Aptos", size: 10, color: { argb: COLOR.ink } };
      valueCell.font = { name: "Aptos", size: 11, bold: true, color: { argb: COLOR.navy } };
      measureCell.alignment = { indent: 1, vertical: "middle", wrapText: true };
      valueCell.alignment = { indent: 1, vertical: "middle", horizontal: typeof rawValue === "number" ? "right" : "left" };
      if (typeof rawValue === "number") {
        valueCell.numFmt = /margin %|rate %/i.test(label) ? percentFormat :
          /\(GHS\)|amount|refunded|expenses|cash|bank|momo|profit|total|receipts in/i.test(label)
            ? moneyFormat : countFormat;
        if (/difference|unknown channel|issues needing investigation/i.test(label) && rawValue !== 0) {
          valueCell.fill = fill(COLOR.redLight);
          valueCell.font = { bold: true, color: { argb: COLOR.red } };
        }
      }
      cover.getRow(cursor).height = label.length > 68 ? 34 : 25;
      cursor += 1;
    }
    cursor += 1;
    band(cursor++, "04  /  WORKSHEET DIRECTORY", COLOR.navy2);
    const worksheetDirectory = [{ name: "Transaction Lines", count: rows.length }, ...sections.map(s => ({ name: s.name, count: s.rows.length }))];
    worksheetDirectory.forEach(({ name, count }, index) => {
      cover.mergeCells(cursor, 1, cursor, 6);
      cover.mergeCells(cursor, 7, cursor, 8);
      const a = cover.getCell(cursor, 1);
      const b = cover.getCell(cursor, 7);
      const target = name.slice(0, 31).replace(/'/g, "''");
      a.value = { text: (index + 1) + ". " + name, hyperlink: "#'" + target + "'!A1" };
      a.font = { name: "Aptos", color: { argb: COLOR.teal }, underline: true, size: 10 };
      b.value = count;
      b.numFmt = countFormat;
      b.font = { name: "Aptos", color: { argb: COLOR.ink }, bold: true, size: 10 };
      a.fill = fill(index % 2 ? COLOR.white : COLOR.stripe);
      b.fill = fill(index % 2 ? COLOR.white : COLOR.stripe);
      a.alignment = { indent: 1, vertical: "middle" };
      b.alignment = { indent: 1, vertical: "middle", horizontal: "right" };
      cover.getRow(cursor).height = 24;
      cursor += 1;
    });
    cursor += 1;
    cover.mergeCells(cursor, 1, cursor, 8);
    const caution = cover.getCell(cursor, 1);
    caution.value = "CONTROL NOTE: Source evidence and period cut-offs must be reconciled. An indicative margin bridge is not a final audited profit figure; stock-only returns do not represent cash paid out.";
    caution.fill = fill(COLOR.amber);
    caution.font = { name: "Aptos", color: { argb: COLOR.navy }, size: 9, italic: true };
    caution.alignment = { indent: 1, vertical: "middle", wrapText: true };
    cover.getRow(cursor).height = 36;
    cover.pageSetup.printArea = "A1:H" + cursor;

    const amountKey = key =>
      /^(unit_price|gross|discount|net|tax|receipt_amount|unit_cost|cost|profit|subtotal|line_subtotal|subtotal_difference|pretax_sales|total|allocated_total|total_difference|paid_lifetime|debt_payments_lifetime|initial_paid_reconstructed|balance_lifetime|refund_amount|cash_refund|momo_refund|bank_refund|other_refund|original_item_gross_estimate|estimated_net_refundable|refund_vs_estimated_value|historical_unit_cost_estimate|recovered_stock_cost_estimate|amount|effective_amount|historical_sale_cost|cash_out|momo_out|bank_out|other_out|sales_total)$/.test(key);
    function columnWidth(column) {
      const key = String(column.key);
      if (/reason|description|issue|review_status|reference/.test(key)) return 43;
      if (/item|customer|product_name/.test(key)) return 32;
      if (/receipt|measure|staff|returned_by|approved_by|collected_by|recorded_by/.test(key)) return 26;
      if (/date|returned_at|paid_at/.test(key)) return 19;
      if (amountKey(key)) return 23;
      return Math.max(16, Math.min(29, column.label.length + 5));
    }
    function addTable(name, cols, records) {
      // Reuse styles across thousands of transaction cells to keep exports efficient.
      const whiteFill = fill(COLOR.white);
      const stripedFill = fill(COLOR.stripe);
      const amberFill = fill(COLOR.amber);
      const redFill = fill(COLOR.redLight);
      const defaultFont = { name: "Aptos", size: 10, color: { argb: COLOR.ink } };
      const warningFont = { name: "Aptos", size: 10, bold: true, color: { argb: COLOR.navy } };
      const redFont = { name: "Aptos", size: 10, bold: true, color: { argb: COLOR.red } };
      const lineBorder = { bottom: { style: "hair", color: { argb: COLOR.border } } };
      const sheet = book.addWorksheet(name.slice(0, 31), {
        properties: { tabColor: { argb: /Exception|Audit/.test(name) ? COLOR.red :
          /Return|Refund/.test(name) ? COLOR.gold : /Summary/.test(name) ? COLOR.teal : COLOR.navy2 } }
      });
      sheet.columns = cols.map(col => ({ key: col.key, width: columnWidth(col) }));
      const headerRow = showDateRange ? 5 : 1;
      sheet.pageSetup = {
        paperSize: 8, orientation: "landscape", fitToPage: true,
        fitToWidth: cols.length > 18 ? 3 : cols.length > 9 ? 2 : 1, fitToHeight: 0,
        margins: { left: 0.3, right: 0.3, top: 0.55, bottom: 0.55, header: 0.2, footer: 0.2 }
      };
      sheet.headerFooter.oddFooter = "&LCHALIN03 • " + clean(name).slice(0, 35) + "&C" + clean(branch).slice(0, 35) + "&RPage &P of &N";
      sheet.printTitlesRow = headerRow + ":" + headerRow;
      if (showDateRange) {
        sheet.addRow([safeCell(title)]);
        sheet.mergeCells(1, 1, 1, Math.max(4, cols.length));
        const titleCell = sheet.getCell(1, 1);
        titleCell.fill = fill(COLOR.navy);
        titleCell.font = { name: "Aptos Display", bold: true, size: 15, color: { argb: COLOR.white } };
        titleCell.alignment = { indent: 1, vertical: "middle", shrinkToFit: true };
        sheet.getRow(1).height = 37;
        sheet.addRow(["From Date", startLabel, "To Date", endLabel]);
        sheet.addRow(["Selected store", safeCell(branch), "Generated", date]);
        sheet.addRow([]);
        for (const rowNum of [2, 3]) {
          for (let index = 1; index <= Math.max(4, cols.length); index++) {
            const cell = sheet.getCell(rowNum, index);
            cell.fill = fill(rowNum === 2 ? COLOR.tealLight : COLOR.blueLight);
            cell.font = {
              name: "Aptos", size: 9, color: { argb: COLOR.ink },
              bold: index === 1 || index === 3
            };
            cell.alignment = { vertical: "middle", shrinkToFit: true };
          }
          sheet.getRow(rowNum).height = 25;
        }
        sheet.getRow(4).height = 10;
      }
      sheet.addRow(cols.map(col => safeCell(col.label)));
      const header = sheet.getRow(headerRow);
      header.height = 39;
      for (let column = 1; column <= cols.length; column++) {
        const cell = header.getCell(column);
        cell.fill = fill(COLOR.navy2);
        cell.font = { name: "Aptos", bold: true, color: { argb: COLOR.white }, size: 10 };
        cell.alignment = { vertical: "middle", wrapText: true, indent: 1 };
        cell.border = { bottom: { style: "medium", color: { argb: COLOR.gold } } };
      }
      records.forEach((record, index) => {
        const values = {};
        cols.forEach(col => { values[col.key] = safeCell(record[col.key]); });
        const row = sheet.addRow(values);
        row.height = /Notes|Exception/.test(name) ? 34 : 25;
        for (let column = 1; column <= cols.length; column++) {
          const descriptor = cols[column - 1];
          const cell = row.getCell(column);
          const key = String(descriptor.key);
          const numeric = typeof cell.value === "number";
          cell.fill = index % 2 ? stripedFill : whiteFill;
          cell.font = defaultFont;
          cell.alignment = {
            vertical: "middle", horizontal: numeric ? "right" : "left",
            wrapText: /item|reason|description|issue|review_status|measure|value/.test(key)
          };
          cell.border = lineBorder;
          if (numeric) {
            cell.numFmt = /margin|percentage/.test(key) ? percentFormat :
              amountKey(key) || (key === "value" && /\(GHS\)|amount|refund|expense|profit|total|money|collected/i.test(String(record.measure || "")))
                ? moneyFormat : countFormat;
          }
          if (/review_status/.test(key) && cell.value &&
              !/^reconciled$/i.test(String(cell.value))) {
            cell.fill = amberFill;
            cell.font = warningFont;
          }
          if (/^status$/.test(key) && /void|reversal|cancel/i.test(String(cell.value || ""))) {
            cell.fill = redFill;
            cell.font = redFont;
          }
          if (/^issue$/.test(key) && cell.value) {
            cell.fill = redFill;
            cell.font = redFont;
          }
        }
      });
      sheet.views = [{ state: "frozen", ySplit: headerRow, xSplit: cols.length > 8 ? 2 : 0 }];
      sheet.autoFilter = {
        from: { row: headerRow, column: 1 },
        to: { row: headerRow + records.length, column: cols.length }
      };
      sheet.pageSetup.printArea = "A1:" + sheet.getColumn(cols.length).letter +
        Math.max(headerRow, headerRow + records.length);
      return sheet;
    }
    addTable("Transaction Lines", columns, rows);
    sections.forEach(section => addTable(section.name, section.columns, section.rows));
    const buffer = await book.xlsx.writeBuffer();
    setHeaders(res, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename + ".xlsx");
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
