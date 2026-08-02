from pathlib import Path
import re

ROUTE_PATH = Path("backend/routes/exportRoutes.js")
TEST_PATH = Path("backend/tests/auditorReportingPeriodBanner.test.js")

source = ROUTE_PATH.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    source = source.replace(old, new, 1)


def replace_between(start_marker: str, end_marker: str, replacement: str, label: str) -> None:
    global source
    start = source.find(start_marker)
    if start < 0:
        raise SystemExit(f"{label}: start marker missing")
    end = source.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"{label}: end marker missing")
    source = source[:start] + replacement + source[end:]


DATE_HELPERS = '''function parseReportDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const text = cleanText(value);
  if (!text) return null;

  const isoMatch = /^(\\d{4})-(\\d{2})-(\\d{2})/.exec(text);
  if (isoMatch) {
    const date = new Date(
      Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]), 12)
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatReportDate(value) {
  const date = parseReportDate(value);
  if (!date) return "";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Accra",
  })
    .format(date)
    .toUpperCase();
}

function formatReportDateKey(value) {
  const date = parseReportDate(value);
  if (!date) return "";

  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Africa/Accra",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isLikelyReportDateHeader(value) {
  return /(^|[\\s_-])(date|created|updated|sale|sold|paid|payment|purchase|return|closing|adjustment|transfer|issued|received|recorded)([\\s_-]|$)/i.test(
    String(value || "")
  );
}

function deriveWorkbookDateBounds(analysis) {
  let earliest = null;
  let latest = null;

  analysis.forEach((sheet) => {
    const dateIndexes = sheet.headers
      .map((header, index) => (isLikelyReportDateHeader(header) ? index : -1))
      .filter((index) => index >= 0);

    sheet.rows.forEach((row) => {
      dateIndexes.forEach((index) => {
        const date = parseReportDate(row[index]);
        if (!date) return;
        if (!earliest || date < earliest) earliest = date;
        if (!latest || date > latest) latest = date;
      });
    });
  });

  return { earliest, latest };
}

function getDateRangeMeta(from, to, analysis) {
  const bounds = deriveWorkbookDateBounds(analysis);
  const fromDate = parseReportDate(from) || bounds.earliest;
  const toDate = parseReportDate(to) || bounds.latest;
  const fromLabel = formatReportDate(fromDate);
  const toLabel = formatReportDate(toDate);
  const fromKey = formatReportDateKey(fromDate);
  const toKey = formatReportDateKey(toDate);

  if (fromLabel && toLabel) {
    return {
      fromLabel,
      toLabel,
      periodLabel: `${fromLabel} TO ${toLabel}`,
      periodBanner: `REPORTING PERIOD: FROM ${fromLabel} TO ${toLabel}`,
      filenamePart: `${fromKey}-to-${toKey}`,
    };
  }

  if (fromLabel) {
    return {
      fromLabel,
      toLabel: "LATEST AVAILABLE RECORD",
      periodLabel: `FROM ${fromLabel} TO LATEST AVAILABLE RECORD`,
      periodBanner: `REPORTING PERIOD: FROM ${fromLabel} TO LATEST AVAILABLE RECORD`,
      filenamePart: `from-${fromKey}`,
    };
  }

  if (toLabel) {
    return {
      fromLabel: "EARLIEST AVAILABLE RECORD",
      toLabel,
      periodLabel: `FROM EARLIEST AVAILABLE RECORD TO ${toLabel}`,
      periodBanner: `REPORTING PERIOD: FROM EARLIEST AVAILABLE RECORD TO ${toLabel}`,
      filenamePart: `to-${toKey}`,
    };
  }

  return {
    fromLabel: "NOT AVAILABLE",
    toLabel: "NOT AVAILABLE",
    periodLabel: "NO DATED RECORDS AVAILABLE",
    periodBanner: "REPORTING PERIOD: NO DATED RECORDS AVAILABLE",
    filenamePart: "no-dated-records",
  };
}
'''

EXCEL_BLOCK = '''  if (simpleHeader && baseName !== "daily-closings") {
    worksheet.insertRows(1, [[], [], [], [], [], []]);
    headerRowIndex = 7;

    const lastColumn = Math.max(analysis.columnCount, 1);
    worksheet.mergeCells(1, 1, 1, lastColumn);
    worksheet.mergeCells(2, 1, 2, lastColumn);
    worksheet.mergeCells(3, 1, 3, lastColumn);
    worksheet.mergeCells(4, 1, 4, lastColumn);
    worksheet.mergeCells(5, 1, 5, lastColumn);

    worksheet.getCell(1, 1).value = "CHALIN 03 COMPANY LIMITED";
    worksheet.getCell(2, 1).value = meta.reportTitle;
    worksheet.getCell(3, 1).value = `${meta.branch.code} - ${meta.branch.name}${
      meta.branch.location ? ` | ${meta.branch.location}` : ""
    }`;
    worksheet.getCell(4, 1).value = meta.periodBanner;
    worksheet.getCell(5, 1).value = `Generated: ${meta.generatedLabel} | By: ${meta.generatedBy}`;

    worksheet.getCell(1, 1).font = {
      bold: true,
      size: 16,
      color: { argb: "FFFFFFFF" },
    };
    worksheet.getCell(1, 1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF071529" },
    };
    worksheet.getCell(1, 1).alignment = {
      horizontal: "center",
      vertical: "middle",
    };
    worksheet.getRow(1).height = 30;

    worksheet.getCell(2, 1).font = {
      bold: true,
      size: 14,
      color: { argb: "FF173B68" },
    };
    worksheet.getCell(2, 1).alignment = { horizontal: "center" };
    worksheet.getRow(2).height = 25;

    worksheet.getCell(3, 1).font = {
      bold: true,
      size: 10,
      color: { argb: "FF334155" },
    };
    worksheet.getCell(3, 1).alignment = { horizontal: "center" };

    worksheet.getCell(4, 1).font = {
      bold: true,
      size: 13,
      color: { argb: "FF071529" },
    };
    worksheet.getCell(4, 1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE6B91E" },
    };
    worksheet.getCell(4, 1).alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };
    worksheet.getCell(4, 1).border = {
      top: { style: "medium", color: { argb: "FF071529" } },
      bottom: { style: "medium", color: { argb: "FF071529" } },
    };
    worksheet.getRow(4).height = 28;

    worksheet.getCell(5, 1).font = {
      size: 9,
      color: { argb: "FF475569" },
    };
    worksheet.getCell(5, 1).alignment = { horizontal: "center" };
    worksheet.getRow(6).height = 8;
  }
'''

PDF_HEADER_BLOCK = '''  doc.y = 96;
  doc.fillColor("#173b68").font("Helvetica-Bold").fontSize(15);
  doc.text(pdfSafeText(sectionTitle), { align: "center" });
  doc.moveDown(0.35);

  const periodY = doc.y;
  doc.save();
  doc.roundedRect(left, periodY, width, 30, 4).fill("#e6b91e");
  doc.fillColor("#071529").font("Helvetica-Bold").fontSize(10);
  doc.text(pdfSafeText(meta.periodBanner), left + 8, periodY + 9, {
    width: width - 16,
    align: "center",
    lineBreak: false,
  });
  doc.restore();
  doc.y = periodY + 36;

  if (subtitle) {
    doc.fillColor("#475569").font("Helvetica").fontSize(8);
    doc.text(pdfSafeText(subtitle), { align: "center" });
    doc.moveDown(0.25);
  }

  doc.moveDown(0.35);
'''

if "function getDateRangeMeta(" not in source:
    pattern = re.compile(
        r"function getDateRangeLabel\(from, to\) \{.*?\n\}\n",
        re.DOTALL,
    )
    source, count = pattern.subn(DATE_HELPERS, source, count=1)
    if count != 1:
        raise SystemExit(f"date range helpers: expected one match, found {count}")

if "worksheet.getCell(4, 1).value = meta.periodBanner;" not in source:
    replace_between(
        '  if (simpleHeader && baseName !== "daily-closings") {',
        "\n  const headerRow = worksheet.getRow(headerRowIndex);",
        EXCEL_BLOCK,
        "Excel report header",
    )

if 'printTitlesRow: simpleHeader && baseName !== "daily-closings" ? "1:7"' not in source:
    source = source.replace(
        'printTitlesRow: simpleHeader && baseName !== "daily-closings" ? "1:6" : `${headerRowIndex}:${headerRowIndex}`,',
        'printTitlesRow: simpleHeader && baseName !== "daily-closings" ? "1:7" : `${headerRowIndex}:${headerRowIndex}`,',
        1,
    )

if "worksheet.headerFooter.oddHeader = `&C&B${meta.periodBanner}`;" not in source:
    anchor = '  worksheet.headerFooter.oddFooter =\n    `&LChalin 03 - ${meta.branch.code}&C${meta.reportTitle}&RPage &P of &N`;'
    replacement = '  worksheet.headerFooter.oddHeader = `&C&B${meta.periodBanner}`;\n  worksheet.headerFooter.oddFooter =\n    `&LChalin 03 - ${meta.branch.code}&C${meta.reportTitle}&RPage &P of &N`;'
    replace_once(anchor, replacement, "Excel printed header")

if 'summary.getCell("A3").value = meta.periodBanner;' not in source:
    summary_banner = '''  summary.mergeCells("A3:C3");
  summary.getCell("A3").value = meta.periodBanner;
  summary.getCell("A3").font = {
    bold: true,
    size: 13,
    color: { argb: "FF071529" },
  };
  summary.getCell("A3").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE6B91E" },
  };
  summary.getCell("A3").alignment = {
    horizontal: "center",
    vertical: "middle",
    wrapText: true,
  };
  summary.getRow(3).height = 28;

'''
    function_start = source.index("function addExecutiveSummarySheet")
    info_pos = source.index("  const information = [", function_start)
    source = source[:info_pos] + summary_banner + source[info_pos:]
    row_pos = source.index("  let rowNumber = 4;", info_pos)
    source = source[:row_pos] + source[row_pos:].replace("  let rowNumber = 4;", "  let rowNumber = 5;", 1)
    source = source.replace(
        '  summary.views = [{ state: "frozen", ySplit: 2 }];',
        '  summary.views = [{ state: "frozen", ySplit: 3 }];',
        1,
    )

if 'doc.roundedRect(left, periodY, width, 30, 4).fill("#e6b91e")' not in source:
    pdf_start = source.index("  doc.y = 96;", source.index("function drawPdfDocumentHeader"))
    pdf_end_marker = "  doc.moveDown(0.6);\n"
    pdf_end = source.index(pdf_end_marker, pdf_start) + len(pdf_end_marker)
    source = source[:pdf_start] + PDF_HEADER_BLOCK + source[pdf_end:]

source = source.replace(
    'drawPdfDocumentHeader(doc, meta, meta.reportTitle, `Period: ${meta.periodLabel}`);',
    'drawPdfDocumentHeader(doc, meta, meta.reportTitle, "Controlled auditor export");',
    1,
)
source = source.replace(
    '`${sheet.recordCount} detail row(s) | Period: ${meta.periodLabel}`',
    '`${sheet.recordCount} detail row(s)`',
    1,
)
if "| ${pdfSafeText(meta.periodLabel)} | Page" not in source:
    source = source.replace(
        ') } | Page ${pageIndex + 1} of ${pageRange.count}`',
        ') } | ${pdfSafeText(meta.periodLabel)} | Page ${pageIndex + 1} of ${pageRange.count}`',
        1,
    )
    if "| ${pdfSafeText(meta.periodLabel)} | Page" not in source:
        source = source.replace(
            ') } | Page ${pageIndex + 1} of ${pageRange.count}`'.replace(" ", ""),
            ') } | ${pdfSafeText(meta.periodLabel)} | Page ${pageIndex + 1} of ${pageRange.count}`'.replace(" ", ""),
            1,
        )

if '<div class="period-banner">${escapeHtml(meta.periodBanner)}</div>' not in source:
    source = source.replace(
        '''          <h2>${escapeHtml(sheet.name + bandLabel)}</h2>
          <p class="section-meta">${escapeHtml(
            `${meta.branch.code} - ${meta.branch.name} | ${sheet.recordCount} detail row(s) | ${meta.periodLabel}`
          )}</p>''',
        '''          <h2>${escapeHtml(sheet.name + bandLabel)}</h2>
          <div class="period-banner">${escapeHtml(meta.periodBanner)}</div>
          <p class="section-meta">${escapeHtml(
            `${meta.branch.code} - ${meta.branch.name} | ${sheet.recordCount} detail row(s)`
          )}</p>''',
        1,
    )
    source = source.replace(
        '  .subtitle, .section-meta { color: #475569; text-align: center; }',
        '  .subtitle, .section-meta { color: #475569; text-align: center; }\n  .period-banner { margin: 12px auto; padding: 10px 12px; background: #e6b91e; color: #071529; border: 2px solid #071529; font-size: 12pt; font-weight: 700; text-align: center; }',
        1,
    )
    source = source.replace(
        '''    <h1>${escapeHtml(meta.reportTitle)}</h1>
    <p class="subtitle">Professional Microsoft Word Export</p>''',
        '''    <h1>${escapeHtml(meta.reportTitle)}</h1>
    <div class="period-banner">${escapeHtml(meta.periodBanner)}</div>
    <p class="subtitle">Professional Microsoft Word Export</p>''',
        1,
    )

if "const period = getDateRangeMeta(" not in source:
    meta_pattern = re.compile(
        r"  const meta = \{\n    branch,\n    reportTitle,\n    periodLabel: getDateRangeLabel\(cleanText\(req\.query\.from\), cleanText\(req\.query\.to\)\),\n    generatedLabel: new Date\(\)\.toLocaleString\(\"en-GB\"\),\n    generatedBy,\n  \};"
    )
    meta_replacement = '''  const period = getDateRangeMeta(
    cleanText(req.query.from),
    cleanText(req.query.to),
    analysis
  );
  const meta = {
    branch,
    reportTitle,
    ...period,
    generatedLabel: new Date().toLocaleString("en-GB", {
      timeZone: "Africa/Accra",
    }),
    generatedBy,
  };'''
    source, count = meta_pattern.subn(meta_replacement, source, count=1)
    if count != 1:
        raise SystemExit(f"Export metadata date range: expected one match, found {count}")

if "const periodFilename = meta.filenamePart" not in source:
    source = source.replace(
        "  const safeBase = safeFilenamePart(baseName);\n",
        '  const safeBase = safeFilenamePart(baseName);\n  const periodFilename = meta.filenamePart ? `-${meta.filenamePart}` : "";\n',
        1,
    )

source = source.replace(
    '`chalin03-${safeBranch}-${safeBase}.pdf`',
    '`chalin03-${safeBranch}-${safeBase}${periodFilename}.pdf`',
    1,
)
source = source.replace(
    '`chalin03-${safeBranch}-${safeBase}.doc`',
    '`chalin03-${safeBranch}-${safeBase}${periodFilename}.doc`',
    1,
)
source = source.replace(
    '`chalin03-${safeBranch}-${safeBase}.xlsx`',
    '`chalin03-${safeBranch}-${safeBase}${periodFilename}.xlsx`',
    1,
)

ROUTE_PATH.write_text(source, encoding="utf-8")

TEST_PATH.write_text(
    '''const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "routes", "exportRoutes.js"),
  "utf8"
);

test("all main Excel, PDF and Word exports use the vivid reporting period banner", () => {
  assert.match(source, /function getDateRangeMeta\\(/);
  assert.match(source, /REPORTING PERIOD: FROM/);
  assert.match(source, /meta\\.periodBanner/);
  assert.match(source, /fgColor: \\{ argb: "FFE6B91E" \\}/);
  assert.match(source, /roundedRect\\(left, periodY, width, 30, 4\\)/);
  assert.match(source, /class="period-banner"/);
  assert.doesNotMatch(source, /Period: \\$\\{meta\\.periodLabel\\} \\| Generated:/);
});

test("all-record exports derive earliest and latest dated records", () => {
  assert.match(source, /function deriveWorkbookDateBounds\\(/);
  assert.match(source, /parseReportDate\\(row\\[index\\]\\)/);
  assert.match(source, /parseReportDate\\(from\\) \\|\\| bounds\\.earliest/);
  assert.match(source, /parseReportDate\\(to\\) \\|\\| bounds\\.latest/);
});

test("report filenames carry the authoritative period", () => {
  assert.match(source, /periodFilename/);
  assert.match(source, /filenamePart: `\\$\\{fromKey\\}-to-\\$\\{toKey\\}`/);
  assert.match(source, /safeBase\\}\\$\\{periodFilename\\}\\.xlsx/);
  assert.match(source, /safeBase\\}\\$\\{periodFilename\\}\\.pdf/);
  assert.match(source, /safeBase\\}\\$\\{periodFilename\\}\\.doc/);
});
''',
    encoding="utf-8",
)
