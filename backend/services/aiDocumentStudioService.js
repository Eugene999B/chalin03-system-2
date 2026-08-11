"use strict";

const crypto = require("node:crypto");
const PDFDocument = require("pdfkit");
const ExcelJS = require("./excelJsCompat");

const SUPPORTED_AI_DOCUMENT_FORMATS = Object.freeze(["pdf", "xlsx", "csv", "docx"]);
const MAX_TITLE_CHARACTERS = 180;
const MAX_ANSWER_CHARACTERS = 120000;
const MAX_EVIDENCE_ITEMS = 48;
const MAX_EVIDENCE_EXCERPT_CHARACTERS = 5000;

const FORMAT_META = Object.freeze({
  pdf: Object.freeze({ extension: "pdf", content_type: "application/pdf" }),
  xlsx: Object.freeze({
    extension: "xlsx",
    content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }),
  csv: Object.freeze({ extension: "csv", content_type: "text/csv; charset=utf-8" }),
  docx: Object.freeze({
    extension: "docx",
    content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }),
});

function clean(value, maximum = MAX_ANSWER_CHARACTERS) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, maximum);
}

function normalizeDocumentFormat(value) {
  const raw = clean(value, 20).toLowerCase().replace(/^\./, "");
  const aliases = {
    excel: "xlsx",
    spreadsheet: "xlsx",
    word: "docx",
    document: "docx",
  };
  const format = aliases[raw] || raw;
  return SUPPORTED_AI_DOCUMENT_FORMATS.includes(format) ? format : null;
}

function sanitizeFilename(value, fallback = "chalin-intelligence-report") {
  const cleaned = clean(value, 180)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}

function safeSpreadsheetText(value) {
  const text = clean(value, 32000);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function normalizedEvidence(evidence = []) {
  return (Array.isArray(evidence) ? evidence : [])
    .slice(0, MAX_EVIDENCE_ITEMS)
    .map((item, index) =>
      Object.freeze({
        citation: clean(item?.citation || `E${index + 1}`, 32) || `E${index + 1}`,
        label: clean(item?.label || "Approved evidence", 240) || "Approved evidence",
        source_type: clean(item?.source_type || "approved_evidence", 120) || "approved_evidence",
        source_ref: clean(item?.source_ref || "", 300),
        source_version: clean(item?.source_version || "", 100),
        classification: clean(item?.classification || "internal", 80) || "internal",
        workspace_code: clean(item?.workspace_code || "", 80),
        as_of_at: item?.as_of_at ? clean(item.as_of_at, 80) : "",
        excerpt_text: clean(item?.excerpt_text || "", MAX_EVIDENCE_EXCERPT_CHARACTERS),
      })
    );
}

function classificationRank(value) {
  const key = clean(value, 80).toLowerCase();
  return { public: 0, internal: 1, confidential: 2, restricted: 3, sensitive: 3 }[key] ?? 1;
}

function highestClassification(evidence = []) {
  return normalizedEvidence(evidence).reduce(
    (highest, item) =>
      classificationRank(item.classification) > classificationRank(highest)
        ? item.classification
        : highest,
    "public"
  );
}

function normalizedPayload(input = {}) {
  const evidence = normalizedEvidence(input.evidence);
  const title = clean(input.title || "CHALIN Intelligence Report", MAX_TITLE_CHARACTERS) ||
    "CHALIN Intelligence Report";
  const answer = clean(input.answer, MAX_ANSWER_CHARACTERS);
  if (!answer) {
    const error = new Error("A non-empty CHALIN Intelligence answer is required for document generation.");
    error.code = "AI_DOCUMENT_ANSWER_REQUIRED";
    error.statusCode = 400;
    throw error;
  }
  return Object.freeze({
    title,
    answer,
    evidence,
    classification: highestClassification(evidence),
    generated_at: input.generated_at || new Date().toISOString(),
    actor_name: clean(input.actor_name || input.actor_username || "Authorized CHALIN user", 180),
    actor_username: clean(input.actor_username || "", 120),
    actor_role: clean(input.actor_role || "", 80),
    workspace_code: clean(input.workspace_code || "", 80),
    conversation_key: clean(input.conversation_key || "", 100),
    message_key: clean(input.message_key || "", 100),
    request_id: clean(input.request_id || "", 100),
  });
}

function provenanceLines(payload) {
  return [
    ["Generated", payload.generated_at],
    ["Prepared for", payload.actor_name || payload.actor_username],
    ["Role", payload.actor_role],
    ["Workspace", payload.workspace_code],
    ["Classification", payload.classification],
    ["Conversation", payload.conversation_key],
    ["Message", payload.message_key],
    ["Request", payload.request_id],
  ].filter(([, value]) => value);
}

function renderPdf(payload) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: true });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.font("Helvetica-Bold").fontSize(17).text("CHALIN 03 COMPANY LIMITED", { align: "center" });
    doc.font("Helvetica").fontSize(8).fillColor("#475569").text("CHALIN Intelligence · Governed document output", { align: "center" });
    doc.moveDown(0.6);
    doc.strokeColor("#1e3a5f").lineWidth(1).moveTo(42, doc.y).lineTo(doc.page.width - 42, doc.y).stroke();
    doc.moveDown(0.8);
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(15).text(payload.title, { align: "center" });
    doc.moveDown(0.8);

    for (const [label, value] of provenanceLines(payload)) {
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#64748b").text(`${label}: `, { continued: true });
      doc.font("Helvetica").fillColor("#0f172a").text(String(value));
    }

    doc.moveDown(0.7);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#17395f").text("INTELLIGENCE SUMMARY");
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(9.5).fillColor("#0f172a").text(payload.answer, { lineGap: 2 });

    if (payload.evidence.length) {
      doc.moveDown(1);
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#17395f").text("GOVERNED EVIDENCE");
      for (const item of payload.evidence) {
        if (doc.y > doc.page.height - 130) doc.addPage();
        doc.moveDown(0.55);
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0f172a").text(`[${item.citation}] ${item.label}`);
        doc.font("Helvetica").fontSize(7.8).fillColor("#475569").text(
          [item.source_type, item.source_ref, item.source_version ? `v${item.source_version}` : "", item.as_of_at ? `as of ${item.as_of_at}` : ""]
            .filter(Boolean)
            .join(" · ")
        );
        if (item.excerpt_text) {
          doc.font("Helvetica").fontSize(8.5).fillColor("#1f2937").text(item.excerpt_text, { lineGap: 1.5 });
        }
      }
    }

    const range = doc.bufferedPageRange();
    for (let page = range.start; page < range.start + range.count; page += 1) {
      doc.switchToPage(page);
      const y = doc.page.height - 28;
      doc.strokeColor("#cbd5e1").lineWidth(0.5).moveTo(42, y - 7).lineTo(doc.page.width - 42, y - 7).stroke();
      doc.font("Helvetica").fontSize(7).fillColor("#64748b").text(
        `Generated from authenticated CHALIN Intelligence · ${payload.classification.toUpperCase()}`,
        42,
        y,
        { width: doc.page.width - 150, lineBreak: false }
      );
      doc.text(`Page ${page + 1} of ${range.count}`, doc.page.width - 105, y, { width: 63, align: "right", lineBreak: false });
    }

    doc.end();
  });
}

async function renderXlsx(payload) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CHALIN Intelligence";
  workbook.created = new Date(payload.generated_at);
  workbook.subject = payload.title;

  const summary = workbook.addWorksheet("Intelligence Summary");
  summary.columns = [{ width: 24 }, { width: 90 }];
  summary.mergeCells("A1:B1");
  summary.getCell("A1").value = payload.title;
  summary.getCell("A1").font = { bold: true, size: 16 };
  summary.getCell("A1").alignment = { horizontal: "center" };
  let row = 3;
  for (const [label, value] of provenanceLines(payload)) {
    summary.getCell(row, 1).value = label;
    summary.getCell(row, 1).font = { bold: true };
    summary.getCell(row, 2).value = safeSpreadsheetText(value);
    row += 1;
  }
  row += 1;
  summary.getCell(row, 1).value = "Answer";
  summary.getCell(row, 1).font = { bold: true };
  summary.getCell(row, 2).value = safeSpreadsheetText(payload.answer);
  summary.getCell(row, 2).alignment = { wrapText: true, vertical: "top" };

  const evidence = workbook.addWorksheet("Governed Evidence");
  evidence.columns = [
    { header: "Citation", key: "citation", width: 12 },
    { header: "Label", key: "label", width: 32 },
    { header: "Source Type", key: "source_type", width: 22 },
    { header: "Source Reference", key: "source_ref", width: 38 },
    { header: "Version", key: "source_version", width: 14 },
    { header: "As Of", key: "as_of_at", width: 23 },
    { header: "Classification", key: "classification", width: 18 },
    { header: "Excerpt", key: "excerpt_text", width: 90 },
  ];
  evidence.getRow(1).font = { bold: true };
  for (const item of payload.evidence) {
    evidence.addRow(
      Object.fromEntries(
        Object.entries(item).map(([key, value]) => [key, safeSpreadsheetText(value)])
      )
    );
  }
  evidence.eachRow((sheetRow, number) => {
    if (number > 1) sheetRow.alignment = { vertical: "top", wrapText: true };
  });
  evidence.views = [{ state: "frozen", ySplit: 1 }];

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function csvCell(value) {
  const text = safeSpreadsheetText(value).replace(/"/g, '""');
  return `"${text}"`;
}

function renderCsv(payload) {
  const rows = [
    ["section", "field", "value"],
    ["summary", "title", payload.title],
    ...provenanceLines(payload).map(([label, value]) => ["provenance", label, value]),
    ["summary", "answer", payload.answer],
  ];
  for (const item of payload.evidence) {
    rows.push(["evidence", `[${item.citation}] ${item.label}`, [item.source_type, item.source_ref, item.source_version, item.as_of_at, item.classification, item.excerpt_text].filter(Boolean).join(" | ")]);
  }
  return Buffer.from(`\uFEFF${rows.map((columns) => columns.map(csvCell).join(",")).join("\r\n")}\r\n`, "utf8");
}

function xmlEscape(value) {
  return clean(value, MAX_ANSWER_CHARACTERS)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(dateValue) {
  const date = new Date(dateValue);
  const year = Math.max(1980, date.getUTCFullYear());
  const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return { dosTime, dosDate };
}

function zipStore(entries, dateValue) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosTime, dosDate } = dosDateTime(dateValue);

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    localParts.push(local, data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  }

  const centralBuffer = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralBuffer, end]);
}

function paragraphXml(text, bold = false) {
  const lines = clean(text, MAX_ANSWER_CHARACTERS).split("\n");
  return lines
    .map((line) => `<w:p><w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${xmlEscape(line || " ")}</w:t></w:r></w:p>`)
    .join("");
}

function renderDocx(payload) {
  const body = [
    paragraphXml("CHALIN 03 COMPANY LIMITED", true),
    paragraphXml(payload.title, true),
    ...provenanceLines(payload).map(([label, value]) => paragraphXml(`${label}: ${value}`)),
    paragraphXml("INTELLIGENCE SUMMARY", true),
    paragraphXml(payload.answer),
    payload.evidence.length ? paragraphXml("GOVERNED EVIDENCE", true) : "",
    ...payload.evidence.flatMap((item) => [
      paragraphXml(`[${item.citation}] ${item.label}`, true),
      paragraphXml([item.source_type, item.source_ref, item.source_version, item.as_of_at, item.classification].filter(Boolean).join(" · ")),
      item.excerpt_text ? paragraphXml(item.excerpt_text) : "",
    ]),
  ].join("");

  const entries = [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    },
    {
      name: "word/document.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`,
    },
    {
      name: "word/_rels/document.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
    },
    {
      name: "docProps/core.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(payload.title)}</dc:title><dc:creator>CHALIN Intelligence</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${xmlEscape(payload.generated_at)}</dcterms:created></cp:coreProperties>`,
    },
    {
      name: "docProps/app.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>CHALIN Intelligence</Application></Properties>`,
    },
  ];
  return zipStore(entries, payload.generated_at);
}

async function renderAiDocument(input = {}, formatValue) {
  const format = normalizeDocumentFormat(formatValue);
  if (!format) {
    const error = new Error("Unsupported CHALIN Intelligence document format.");
    error.code = "AI_DOCUMENT_FORMAT_UNSUPPORTED";
    error.statusCode = 400;
    throw error;
  }
  const payload = normalizedPayload(input);
  let buffer;
  if (format === "pdf") buffer = await renderPdf(payload);
  else if (format === "xlsx") buffer = await renderXlsx(payload);
  else if (format === "csv") buffer = renderCsv(payload);
  else buffer = renderDocx(payload);

  const meta = FORMAT_META[format];
  return Object.freeze({
    format,
    extension: meta.extension,
    content_type: meta.content_type,
    filename: `${sanitizeFilename(input.filename || payload.title)}.${meta.extension}`,
    buffer,
    byte_length: buffer.length,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    classification: payload.classification,
    evidence_count: payload.evidence.length,
  });
}

module.exports = {
  FORMAT_META,
  MAX_ANSWER_CHARACTERS,
  MAX_EVIDENCE_EXCERPT_CHARACTERS,
  MAX_EVIDENCE_ITEMS,
  MAX_TITLE_CHARACTERS,
  SUPPORTED_AI_DOCUMENT_FORMATS,
  clean,
  crc32,
  csvCell,
  highestClassification,
  normalizeDocumentFormat,
  normalizedEvidence,
  normalizedPayload,
  renderAiDocument,
  renderCsv,
  renderDocx,
  renderPdf,
  renderXlsx,
  safeSpreadsheetText,
  sanitizeFilename,
  xmlEscape,
  zipStore,
};
