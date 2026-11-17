"use strict";
const ExcelJS = require("./excelJsCompat");
const PDFDocument = require("pdfkit");
const { renderBusinessChartPng } = require("./reportPresentationCharts");

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
    rows, metrics = [], filename = "chalin03-audit", sections = [], fromDate, toDate,
    charts = [], dashboardCards = [], primarySectionName = "Transaction Lines" } = config;
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
    const cards = dashboardCards.length ? dashboardCards.map(item => ({
      ...item, tone: item.tone || COLOR.teal
    })) : transactionReport ? [
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
    const detailsBandRow = cards.length > 4 ? 14 : 10;
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
    const worksheetDirectory = [
      ...(charts.length ? [{ name: "Presentation Charts", count: charts.length }] : []),
      ...(charts.length ? [{ name: "Visual Analysis", count: charts.length }] : []),
      { name: primarySectionName, count: rows.length },
      ...sections.map(s => ({ name: s.name, count: s.rows.length }))
    ];
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
    function addVisualAnalysis() {
      const chartSheet = book.addWorksheet("Visual Analysis", {
        properties: { tabColor: { argb: COLOR.gold } },
        views: [{ state: "frozen", ySplit: 3 }]
      });
      chartSheet.columns = Array.from({length:12},(_,i)=>({
        key:"visual_col_"+i,width:i<4?15:i===4?20:12
      }));
      chartSheet.mergeCells("A1:L1");
      chartSheet.getCell("A1").value="CHALIN03  /  SPARE PARTS  /  DATA VISUALISATION";
      chartSheet.getCell("A1").fill=fill(COLOR.navy);
      chartSheet.getCell("A1").font={bold:true,color:{argb:COLOR.white},size:14};
      chartSheet.getRow(1).height=36;
      chartSheet.mergeCells("A2:L2");
      chartSheet.getCell("A2").value="Comparative chart bars use the same source numbers as the supporting worksheets. All money is GHS.";
      chartSheet.getCell("A2").font={size:10,color:{argb:COLOR.muted},italic:true};
      chartSheet.getRow(2).height=29;
      let row=4;
      for(const chart of charts.slice(0,8)) {
        chartSheet.mergeCells(row,1,row,12);
        chartSheet.getCell(row,1).value=safeCell(chart.title);
        chartSheet.getCell(row,1).fill=fill(COLOR.navy2);
        chartSheet.getCell(row,1).font={bold:true,color:{argb:COLOR.white},size:12};
        chartSheet.getRow(row).height=31;
        row++;
        chartSheet.mergeCells(row,1,row,12);
        chartSheet.getCell(row,1).value=safeCell(chart.note||chart.unit||"");
        chartSheet.getCell(row,1).font={size:9,italic:true,color:{argb:COLOR.muted}};
        chartSheet.getRow(row).height=27;
        row++;
        const points=Array.isArray(chart.points)?chart.points.slice(0,31):[];
        const maxValue=Math.max(0,...points.map(p=>Number(p.value)||0));
        if(!points.length){
          chartSheet.mergeCells(row,1,row,12);
          chartSheet.getCell(row,1).value="No matching source records for this chart.";
          row+=2; continue;
        }
        points.forEach((point,i)=>{
          chartSheet.mergeCells(row,1,row,4);
          chartSheet.getCell(row,1).value=safeCell(String(point.label).slice(0,150));
          chartSheet.getCell(row,1).font={name:"Aptos",size:9,color:{argb:COLOR.ink}};
          chartSheet.getCell(row,1).alignment={vertical:"middle",indent:1,shrinkToFit:true};
          const value=Number(point.value)||0;
          const valueCell=chartSheet.getCell(row,5);
          valueCell.value=value;
          valueCell.numFmt=moneyFormat;
          valueCell.font={bold:true,size:10,color:{argb:COLOR.navy}};
          valueCell.alignment={horizontal:"right",vertical:"middle"};
          const filled=maxValue>0?Math.round(Math.max(0,value)/maxValue*7):0;
          for(let n=0;n<7;n++){
            const cell=chartSheet.getCell(row,6+n);
            cell.value=" ";
            cell.fill=fill(n<filled?(i%2?COLOR.teal:COLOR.navy2):COLOR.blueLight);
          }
          chartSheet.getRow(row).height=23;
          row++;
        });
        row+=2;
      }
      chartSheet.pageSetup={
        paperSize:9,orientation:"landscape",fitToPage:true,fitToWidth:1,fitToHeight:0,
      };
      chartSheet.headerFooter.oddFooter="&LCHALIN03 business visuals&C"+clean(branch).slice(0,34)+"&RPage &P of &N";
      chartSheet.pageSetup.printArea="A1:L"+Math.max(4,row);
    }


    async function addPresentationCharts() {
      const sheet = book.addWorksheet("Presentation Charts", {
        properties: { tabColor: { argb: COLOR.teal }, defaultRowHeight: 20 },
        views: [{state:"frozen",ySplit:3}],
      });
      sheet.columns = Array.from({length:12},()=>({width:15}));
      sheet.mergeCells("A1:L2");
      const masthead=sheet.getCell("A1");
      masthead.value="CHALIN03  /  EXECUTIVE VISUAL BRIEFING";
      masthead.font={name:"Aptos Display",size:18,bold:true,color:{argb:COLOR.white}};
      masthead.fill=fill(COLOR.navy);
      masthead.alignment={vertical:"middle",indent:1};
      sheet.getRow(1).height=24;sheet.getRow(2).height=30;
      sheet.mergeCells("A3:L3");
      sheet.getCell("A3").value=clean(branch)+"   •   "+clean(period||"Current reporting period")+"   •   Figures from original recorded evidence";
      sheet.getCell("A3").font={size:10,color:{argb:COLOR.muted},italic:true};
      sheet.getRow(3).height=28;
      for(let index=0;index<Math.min(charts.length,8);index++){
        const base=5+index*20;
        const chart=charts[index];
        const buffer=await renderBusinessChartPng(chart);
        const imageId=book.addImage({buffer,extension:"png"});
        sheet.addImage(imageId,{tl:{col:0.16,row:base},ext:{width:960,height:405}});
        sheet.getRow(base+16).height=15;
      }
      sheet.headerFooter.oddFooter="&LCHALIN03 • Source-backed management charts&RPage &P of &N";
      sheet.pageSetup={paperSize:9,orientation:"landscape",fitToPage:true,
        fitToWidth:1,fitToHeight:0};
      sheet.pageSetup.printArea="A1:L"+(5+Math.min(charts.length,8)*20);
    }

    if (charts.length) await addPresentationCharts();
    if (charts.length) addVisualAnalysis();
    addTable(primarySectionName, columns, rows);
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
    const renderWordCharts = () => charts.length ? (
      "<h2>Charts and visual analysis</h2>" + charts.slice(0,8).map(chart=>{
        const points=Array.isArray(chart.points)?chart.points.slice(0,20):[];
        const max=Math.max(0,...points.map(p=>Number(p.value)||0));
        const graphRows=points.map(p=>{
          const value=Number(p.value)||0;
          const percent=max>0?Math.round(Math.max(0,value)/max*100):0;
          return "<tr><td style=\"width:28%\">"+html(p.label)+
            "</td><td style=\"width:18%;text-align:right\">"+html(fmtNumber(value))+
            "</td><td style=\"width:54%;background:#edf4f5\"><div style=\"height:14pt;width:"+
            percent+"%;background:#087f75\">&nbsp;</div></td></tr>";
        }).join("");
        return "<h3>"+html(chart.title)+"</h3><p>"+html(chart.unit||"")+
          " | "+html(chart.note||"")+"</p><table>"+graphRows+
          (graphRows?"":"<tr><td>No records in selection</td></tr>")+"</table>";
      }).join("")
    ) : "";
    const editionCards=(dashboardCards.length?dashboardCards:metrics.slice(0,6)
      .map(([label,value])=>({label,value,note:"Recorded source figure"}))).slice(0,8);
    const wordKpis="<table class=\"kpi\"><tbody>"+editionCards.reduce((result,card,i)=>{
      if(i%4===0)result+="<tr>";
      result+="<td><small>"+html(card.label)+"</small><strong>"+html(fmtNumber(card.value))+
        "</strong><em>"+html(card.note||"")+"</em></td>";
      if(i%4===3||i===editionCards.length-1)result+="</tr>";
      return result;
    },"")+"</tbody></table>";
    const wordStories=rows.length?"<h2>Management interpretation</h2>"+
      rows.slice(0,12).map((item,index)=>
        "<table class=\"story\"><tr><th style=\"width:10%\">"+
        String(index+1).padStart(2,"0")+"</th><th>"+
        html(item.topic||item.heading||item[columns?.[0]?.key]||"Analysis")+
        "</th></tr><tr><td></td><td>"+
        html(item.explanation||item.text||item[columns?.[1]?.key]||"")+
        "</td></tr></table>"
      ).join(""):"";
    const wordCover="<div class=\"cover\"><table class=\"topline\"><tr><td><b>CHALIN03</b></td>"+
      "<td style=\"text-align:right\">BUSINESS INTELLIGENCE / MANAGEMENT EDITION</td></tr></table>"+
      "<div class=\"cover-kicker\">SPARE PARTS / CONTROLLED BUSINESS EVIDENCE</div>"+
      "<h1>"+html(title)+"</h1><p class=\"cover-subtitle\">"+
      html(description||"Source-based management reporting")+"</p>"+
      "<table class=\"cover-facts\"><tr><th>STORE</th><th>PERIOD</th><th>GENERATED</th></tr><tr><td>"+
      html(branch)+"</td><td>"+html(period||"Current snapshot")+"</td><td>"+html(date)+"</td></tr></table>"+
      "<div class=\"cover-art\"><span>SALES</span><span>COLLECTIONS</span><span>DEBT</span><span>STOCK</span><span>AUDIT</span></div>"+
      "<p class=\"cover-bottom\">CONFIDENTIAL • PREPARED FROM ORIGINAL STORE RECORDS • GHANA CEDIS</p></div>";
    const wordStyle='<style>'+
      '@page{size:A4;margin:18mm}body{font-family:Calibri,Arial,sans-serif;font-size:10pt;line-height:1.55;color:#1b3844}'+
      '.cover{page-break-after:always;padding:20pt 0 0}.topline{border-collapse:collapse;width:100%;background:#092f3a;color:#fff}.topline td{padding:13pt 12pt;border:0;font-size:9pt}.topline b{font-size:21pt;letter-spacing:-1pt}'+
      '.cover-kicker{margin-top:53pt;color:#0a776e;font-size:9pt;font-weight:bold;letter-spacing:2pt}'+
      'h1{font-size:36pt;line-height:1.05;color:#113644;margin:18pt 0 20pt}'+
      '.cover-subtitle{font-size:14pt;color:#59717b;max-width:450pt;line-height:1.5}'+
      '.cover-facts{margin-top:50pt;width:100%;border-collapse:collapse;border-top:3pt solid #c4a45f}'+
      '.cover-facts th{text-align:left;padding:10pt 7pt;color:#0d6662;background:#eaf3f1;font-size:8pt}'+
      '.cover-facts td{padding:11pt 7pt;border-bottom:1pt solid #c9dad9;font-size:10pt}'+
      '.cover-art{background:#0b343e;color:#f7f8f3;margin-top:30pt;padding:18pt 12pt}'+
      '.cover-art span{padding-right:18pt;font-size:8pt;letter-spacing:1pt}'+
      '.cover-bottom{font-size:8pt;color:#68838b;margin-top:24pt}'+
      '.briefing-header{border-left:5pt solid #0e857a;padding-left:15pt;margin:19pt 0 24pt}'+
      '.briefing-header strong{font-size:23pt;color:#183c46}'+
      'h2{font-size:17pt;color:#163c46;border-bottom:2pt solid #d7b568;padding-bottom:8pt;margin:28pt 0 14pt;page-break-after:avoid}'+
      'h3{font-size:12pt;color:#173c46;margin:17pt 0 7pt;page-break-after:avoid}'+
      'p{color:#536d78;line-height:1.6}'+
      'table{border-collapse:collapse;width:100%;table-layout:auto;margin:10pt 0 17pt}'+
      'th{background:#113b48;color:#fff;text-align:left;font-size:9pt}'+
      'th,td{border-bottom:1pt solid #d7e4e2;padding:7pt 8pt;vertical-align:top;overflow-wrap:anywhere}'+
      'tr:nth-child(even){background:#f5f9f8}thead{display:table-header-group}'+
      '.kpi{table-layout:fixed;margin:12pt 0 22pt}.kpi td{background:#eef5f2;border:3pt solid #fff;width:25%;padding:13pt 7pt}'+
      '.kpi small{display:block;font-size:7pt;font-weight:bold;color:#126c67}'+
      '.kpi strong{display:block;margin:8pt 0;font-size:14pt;color:#173d49}'+
      '.kpi em{display:block;font-style:normal;font-size:8pt;color:#637e81}'+
      '.story{page-break-inside:avoid;margin:12pt 0}.story th{background:#e9f4f0;color:#183d48}'+
      '.story td{font-size:10pt;color:#486473}.note{background:#fff8e8;border-left:4pt solid #dfb55c;padding:12pt;font-size:9pt;color:#5f635f}'+
      '.appendix{page-break-before:always}.subnote{font-size:8pt;color:#72858b}'+
      '</style>';
    const result='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>'+
      html(title)+'</title>'+wordStyle+'</head><body>'+
      wordCover+
      '<div class="briefing-header"><div style="color:#087f75;font-size:9pt;font-weight:bold">01 / EXECUTIVE BRIEF</div>'+
      '<strong>Business performance, explained.</strong><p>Every financial figure below is based on the selected store records and clearly dated evidence.</p></div>'+
      wordKpis+
      wordStories+
      '<div class="note">ACCOUNTING BASIS: Sales values are not cash receipts. Current debtor, supplier and stock balances are download-time snapshots. Recorded money is not a bank-verified balance. Margin figures require valid historical cost and reconciliation.</div>'+
      '<div class="appendix">'+renderWordCharts()+
      '<h2>Evidence & detail</h2>'+
      renderWordTable(primarySectionName,columns,rows)+
      sections.map(section=>renderWordTable(section.name,section.columns,section.rows)).join("")+'</div>'+
      '<p class="subnote">CHALIN03 controlled internal analysis. Findings are indicators for human review, not fraud findings or statutory sign-off.</p></body></html>';
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
    const isPresentation=charts.length>0||dashboardCards.length>0;
    if(isPresentation) {
      const width=doc.page.width,height=doc.page.height;
      doc.rect(0,0,width,height).fill("#082833");
      doc.rect(width-242,0,242,height).fill("#114a4e");
      doc.circle(width-70,170,170).lineWidth(.7).strokeColor("#4c9d98").stroke();
      doc.circle(width-70,170,122).lineWidth(.7).strokeColor("#4c9d98").stroke();
      doc.circle(width-70,170,76).lineWidth(.7).strokeColor("#4c9d98").stroke();
      doc.rect(36,46,43,5).fill("#d3ad65");
      doc.font("Helvetica-Bold").fontSize(18).fillColor("#ffffff")
        .text("CHALIN03",36,63,{width:340});
      doc.font("Helvetica").fontSize(9).fillColor("#b8d8d6")
        .text("SPARE PARTS / MANAGEMENT INTELLIGENCE",36,96,{width:450});
      doc.font("Helvetica-Bold").fontSize(33).fillColor("#fff")
        .text(clean(title),36,145,{width:605,height:115,ellipsis:true});
      doc.font("Helvetica").fontSize(10).fillColor("#c0d8d7")
        .text(clean(description||"A review of original business evidence."),36,257,
          {width:555,height:75,ellipsis:true,lineGap:3});
      const cardsOnCover=(dashboardCards.length?dashboardCards:metrics.slice(0,4)
        .map(([label,value])=>({label,value,note:"Recorded value"}))).slice(0,4);
      const tileWidth=(width-72-24)/4;
      cardsOnCover.forEach((card,index)=>{
        const x=36+index*(tileWidth+8),y=390;
        doc.rect(x,y,tileWidth,105).fill("#15505a");
        doc.rect(x,y,3,105).fill(index===3?"#dfa95e":"#26a79b");
        doc.font("Helvetica-Bold").fontSize(7.4).fillColor("#c2dfdd")
          .text(clean(card.label||"Indicator").slice(0,28),x+12,y+13,
            {width:tileWidth-21,height:20,ellipsis:true});
        doc.font("Helvetica-Bold").fontSize(17).fillColor("#ffffff")
          .text(fmtNumber(card.value),x+12,y+42,
            {width:tileWidth-21,height:23,ellipsis:true});
        doc.font("Helvetica").fontSize(7.3).fillColor("#c5dedc")
          .text(clean(card.note||"").slice(0,70),x+12,y+76,
            {width:tileWidth-21,height:22,ellipsis:true});
      });
      doc.font("Helvetica").fontSize(8).fillColor("#b6d6d3")
        .text("STORE  "+clean(branch).slice(0,65),36,525,{width:350});
      doc.text("PERIOD  "+clean(period||"Current snapshot").slice(0,65),400,525,
        {width:width-436,align:"right"});
      doc.fontSize(7).fillColor("#94b9b6")
        .text("FOR INTERNAL DECISION SUPPORT  |  GENERATED "+date,36,549,{width:width-72});
      // A dedicated editorial explanation page precedes all evidence tables.
      doc.addPage();
      doc.rect(0,0,width,12).fill("#0c7d74");
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#0a7d75")
        .text("01 / MANAGEMENT INTERPRETATION",36,35,{width:width-72});
      doc.font("Helvetica-Bold").fontSize(24).fillColor("#163a49")
        .text("What the numbers are saying",36,60,{width:width-72});
      doc.font("Helvetica").fontSize(9).fillColor("#627985")
        .text("Read the source meaning before presenting a figure as profit, cash or a debt movement.",
          36,101,{width:width-90});
      const stories=rows.slice(0,6);
      stories.forEach((row,index)=>{
        const x=index%2===0?36:430,y=140+Math.floor(index/2)*131;
        doc.rect(x,y,376,119).fill(index%2?"#edf5f3":"#f3f7f8");
        doc.rect(x,y,3,119).fill(index%2?"#c8a35c":"#12877c");
        doc.font("Helvetica-Bold").fontSize(8).fillColor("#177c75")
          .text(String(index+1).padStart(2,"0")+" / "+
            clean(row.topic||row.heading||row[columns?.[0]?.key]||"Analysis").slice(0,75),
            x+13,y+12,{width:349,height:28,ellipsis:true});
        doc.font("Helvetica").fontSize(8.8).fillColor("#304d59")
          .text(clean(row.explanation||row.text||row[columns?.[1]?.key]||""),
            x+13,y+43,{width:349,height:65,ellipsis:true,lineGap:2});
      });
      doc.font("Helvetica").fontSize(8).fillColor("#6c7d80")
        .text("Period activity and current balance snapshots are separate. See basis notes and original records.",
          36,552,{width:width-72});
      doc.addPage();
    } else {
      doc.fillColor("#153B37").font("Helvetica-Bold").fontSize(18).text(title);
      doc.moveDown(.3).font("Helvetica").fontSize(9).fillColor("#536b64").text(description||"");
      doc.moveDown(.4).fontSize(8).fillColor("#153B37");
      meta.forEach(([a,b])=>doc.text(a+": "+fmtNumber(b),{lineGap:2}));
      doc.moveDown(.6);
    }
    const usable=doc.page.width-72;
    function drawPdfCharts() {
      for(const [chartIndex,chart] of charts.slice(0,8).entries()) {
        if(chartIndex>0) doc.addPage();
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#087F75")
          .text("02 / BUSINESS VISUALISATIONS / "+String(chartIndex+1).padStart(2,"0"),
            36,33,{width:usable});
        const points=Array.isArray(chart.points)?chart.points.slice(0,24):[];
        const isLine=chart.kind==="line";
        const count=points.length;
        const height=isLine?250:Math.max(175,Math.min(420,count*32+75));
        if(doc.y+height+40>doc.page.height-43)doc.addPage();
        const x=36,y=doc.y+6,innerX=x+15,innerWidth=usable-30;
        doc.rect(x,y,usable,height).fill("#F4F8FA");
        doc.font("Helvetica-Bold").fontSize(12).fillColor("#173B4F")
          .text(clean(chart.title).slice(0,100),innerX,y+12,{width:innerWidth});
        doc.font("Helvetica").fontSize(8).fillColor("#5D7282")
          .text(clean(chart.note||chart.unit||"").slice(0,220),innerX,y+33,{width:innerWidth});
        const max=Math.max(0,...points.map(p=>Number(p.value)||0),1);
        if(count===0){
          doc.fontSize(10).text("No source records for this chart.",innerX,y+85);
        }else if(isLine) {
          const chartY=y+82,plotHeight=110,plotX=innerX+18;
          const plotWidth=innerWidth-48;
          doc.moveTo(plotX,chartY).lineTo(plotX,chartY+plotHeight)
            .lineTo(plotX+plotWidth,chartY+plotHeight).lineWidth(.75)
            .strokeColor("#BFCED5").stroke();
          points.forEach((p,i)=>{
            const px=plotX+(count===1?plotWidth/2:(i/(count-1))*plotWidth);
            const py=chartY+plotHeight-Math.max(0,Number(p.value)||0)/max*plotHeight;
            if(i===0)doc.moveTo(px,py);else doc.lineTo(px,py);
          });
          doc.strokeColor("#087F75").lineWidth(2).stroke();
          points.forEach((p,i)=>{
            const px=plotX+(count===1?plotWidth/2:i/(count-1)*plotWidth);
            const py=chartY+plotHeight-Math.max(0,Number(p.value)||0)/max*plotHeight;
            doc.circle(px,py,2.1).fill("#E6B91E");
            if(i===0||i===count-1||i%Math.max(1,Math.ceil(count/7))===0){
              doc.fontSize(6.5).fillColor("#526B79").text(String(p.label).slice(0,12),
                Math.max(innerX,px-24),chartY+plotHeight+8,{width:49,align:"center"});
            }
          });
          doc.font("Helvetica").fontSize(8).fillColor("#36586B").text(
            "Peak: "+fmtNumber(max)+" "+clean(chart.unit||""),innerX,y+height-30
          );
        }else{
          const chartX=innerX,amountX=x+usable-115;
          const graphX=innerX+Math.min(215,innerWidth*.45),graphWidth=Math.max(70,innerWidth-330);
          points.forEach((p,i)=>{
            const rowY=y+66+i*32;
            const bar=Math.max(0,Number(p.value)||0)/max*graphWidth;
            doc.font("Helvetica").fontSize(8).fillColor("#203847").text(
              clean(p.label).slice(0,38),chartX,rowY+3,{width:graphX-chartX-11,ellipsis:true}
            );
            doc.rect(graphX,rowY+4,graphWidth,13).fill("#DFE9EE");
            if(bar>0)doc.rect(graphX,rowY+4,bar,13).fill(i%2?"#087F75":"#173B68");
            doc.font("Helvetica-Bold").fontSize(8).fillColor("#203847").text(
              fmtNumber(Number(p.value)||0),amountX,rowY+3,{width:100,align:"right"}
            );
          });
        }
        doc.y=y+height+18;
      }
      // A financial flow drawing explains why payments and invoices differ.
      const movements=charts.find(c=>c.title==="Recorded receipts and refunds")?.points||[];
      if(movements.length>=3){
        const m=movements.map(p=>Math.max(0,Number(p.value)||0));
        const net=m[0]+m[1]-m[2];
        doc.addPage();
        const pw=doc.page.width,margin=36;
        doc.rect(0,0,pw,11).fill("#07867C");
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#0A7C73")
          .text("03 / ACCOUNTING EXPLANATION",margin,36,{width:pw-margin*2});
        doc.font("Helvetica-Bold").fontSize(24).fillColor("#143A47")
          .text("How recorded customer money moves",margin,61,{width:pw-margin*2});
        doc.font("Helvetica").fontSize(10).fillColor("#607B82")
          .text("These entries are not proof of bank or mobile-money settlement.",
            margin,106,{width:pw-margin*2});
        const positions=[36,235,434,633];
        const values=[m[0],m[1],m[2],net];
        const labels=["AT-SALE RECEIPTS","+ LATER REPAYMENTS","- FINANCIAL REFUNDS","= RECORDED NET"];
        values.forEach((value,i)=>{
          const x=positions[i];
          doc.rect(x,170,172,130).fill(i===3?"#0A5D58":"#E9F2F1");
          doc.rect(x,170,172,5).fill(i===2?"#D6A34D":"#0C8579");
          doc.font("Helvetica-Bold").fontSize(8.5).fillColor(i===3?"#D8F0EA":"#19756E")
            .text(labels[i],x+12,190,{width:148});
          doc.font("Helvetica-Bold").fontSize(19).fillColor(i===3?"#FFFFFF":"#153C49")
            .text("GHS "+fmtNumber(value),x+12,231,{width:148,height:40,ellipsis:true});
          if(i<3)doc.font("Helvetica-Bold").fontSize(17).fillColor("#8F9E9A")
            .text(">",x+173,225,{width:26,align:"center"});
        });
        doc.rect(margin,354,pw-margin*2,106).fill("#F5F6EF");
        doc.font("Helvetica-Bold").fontSize(11).fillColor("#143B46")
          .text("WHY THIS MATTERS",margin+16,372,{width:pw-margin*2-32});
        doc.font("Helvetica").fontSize(10).fillColor("#506870")
          .text("This bridge reconciles customer money recorded at sale, repayments received later, "+
            "and financial refunds. It does not subtract expenses or supplier outflows, "+
            "and it cannot replace bank, MoMo or closing reconciliation.",
            margin+16,398,{width:pw-margin*2-32,height:50,ellipsis:true});
      }
      if(charts.length)doc.addPage();
    }
    drawPdfCharts();
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
    renderSection(primarySectionName,columns,rows);
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
