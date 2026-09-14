const {
  COLORS,
  PHOTO_DOCUMENT_TYPES,
  agreementOf,
  clean,
  customerName,
  dateTimeLabel,
  label,
  templateFor,
} = require("./equipmentFinanceDocumentDesignV2Service");
const {
  addPage,
  bodyBottom,
  drawOfficialLogo,
  ensureSpace,
  imageBuffer,
  pageWidth,
} = require("./equipmentFinancePdfV2PageService");
const {
  drawFactGrid,
  sectionTitle,
} = require("./equipmentFinancePdfV2BasicWidgetService");

function writeRawFlow(doc, document, text, options) {
  const width = options.width || pageWidth(doc);
  const x = options.x || doc.page.margins.left;
  const font = options.bold ? "Helvetica-Bold" : options.font || "Helvetica";
  const size = options.size || 8.5;
  const lineGap = options.lineGap ?? 2;
  let words = text.split(/\s+/);

  while (words.length) {
    let available = bodyBottom(doc) - doc.y;
    if (available < size * 3) {
      addPage(doc, document);
      available = bodyBottom(doc) - doc.y;
    }
    let low = 1;
    let high = words.length;
    let fit = 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = words.slice(0, middle).join(" ");
      const height = doc.font(font).fontSize(size).heightOfString(candidate, {
        width,
        lineGap,
        align: options.align || "justify",
      });
      if (height <= available) {
        fit = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    doc.fillColor(options.color || COLORS.ink).font(font).fontSize(size).text(
      words.slice(0, fit).join(" "),
      x,
      doc.y,
      { width, lineGap, align: options.align || "justify", paragraphGap: 0 }
    );
    words = words.slice(fit);
    if (words.length) addPage(doc, document);
  }
}

function writeFlowText(doc, document, value, options = {}) {
  const text = clean(value, "");
  if (!text) return;
  const paragraphs = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const template = templateFor(document);
  const width = options.width || pageWidth(doc);
  const x = options.x || doc.page.margins.left;
  const size = options.size || 8.5;
  const lineGap = options.lineGap ?? 2;

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const height = doc.font(options.bold ? "Helvetica-Bold" : options.font || "Helvetica")
      .fontSize(size)
      .heightOfString(paragraph, {
        width: width - 34,
        lineGap,
        align: options.align || "justify",
      });

    if (height < 145) {
      ensureSpace(doc, document, height + 31);
      const y = doc.y;
      doc.roundedRect(x, y, width, height + 23, 7)
        .fillAndStroke(paragraphIndex % 2 ? COLORS.paper : COLORS.ash, COLORS.line);
      doc.rect(x, y, 5, height + 23).fill(template.accent);
      doc.circle(x + 18, y + 16, 8).fill(COLORS.gold);
      doc.fillColor(COLORS.forestDeep).font("Helvetica-Bold").fontSize(6.2).text(
        String(paragraphIndex + 1).padStart(2, "0"),
        x + 10,
        y + 14,
        { width: 16, align: "center", lineBreak: false }
      );
      doc.fillColor(options.color || COLORS.ink)
        .font(options.bold ? "Helvetica-Bold" : options.font || "Helvetica")
        .fontSize(size)
        .text(paragraph, x + 34, y + 10, {
          width: width - 46,
          lineGap,
          align: options.align || "justify",
        });
      doc.y = y + height + 31;
      return;
    }

    writeRawFlow(doc, document, paragraph, { ...options, x, width });
    doc.y += options.paragraphGap ?? 9;
  });
}

function drawSignatureBlocks(doc, document, roles) {
  sectionTitle(doc, document, "Execution and signatures");
  const snapshot = document.snapshot || {};
  const template = templateFor(document);
  const left = doc.page.margins.left;
  const width = pageWidth(doc);
  const gap = 12;
  const columnWidth = (width - gap) / 2;

  for (let index = 0; index < roles.length; index += 2) {
    ensureSpace(doc, document, 112);
    const y = doc.y;
    roles.slice(index, index + 2).forEach(([role, title], columnIndex) => {
      const x = left + columnIndex * (columnWidth + gap);
      const record = snapshot.signatures?.find((item) => item.signer_role === role);
      const fallback = role === "seller" ? snapshot.company?.authorised_seller_signature_data_url : null;
      const signature = imageBuffer(record?.signature_data_url || fallback);
      doc.roundedRect(x, y, columnWidth, 98, 9).fillAndStroke(COLORS.paper, COLORS.line);
      doc.roundedRect(x, y, columnWidth, 23, 9).fill(template.accent);
      doc.rect(x, y + 11, columnWidth, 12).fill(template.accent);
      doc.fillColor(COLORS.goldBright).font("Helvetica-Bold").fontSize(6.5).text(
        title.toUpperCase(),
        x + 10,
        y + 8,
        { width: columnWidth - 20, align: "center", lineBreak: false, ellipsis: true }
      );
      drawOfficialLogo(doc, x + columnWidth / 2 - 18, y + 30, 36, 36, 0.09);
      if (signature) {
        try {
          doc.image(signature, x + 12, y + 31, { fit: [columnWidth - 24, 31] });
        } catch {
          // Signature line remains available.
        }
      }
      doc.moveTo(x + 14, y + 70).lineTo(x + columnWidth - 14, y + 70)
        .lineWidth(0.65).strokeColor(COLORS.goldDark).stroke();
      doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(6.8).text(
        clean(
          record?.signer_name ||
            (role === "seller" ? snapshot.company?.authorised_seller_name : ""),
          "Name / signature"
        ),
        x + 10,
        y + 78,
        { width: columnWidth - 20, align: "center", lineBreak: false, ellipsis: true }
      );
      doc.fillColor(COLORS.muted).font("Helvetica").fontSize(5.5).text(
        record?.signed_at ? dateTimeLabel(record.signed_at) : "Date / time",
        x + 10,
        y + 89,
        { width: columnWidth - 20, align: "center", lineBreak: false }
      );
    });
    doc.y = y + 108;
  }
}

function drawIdentityAnnex(doc, document, photo) {
  if (!photo || !PHOTO_DOCUMENT_TYPES.has(document.document_type)) return;
  addPage(doc, document);
  sectionTitle(doc, document, "Protected customer identity annex");
  const agreement = agreementOf(document);
  const template = templateFor(document);
  const left = doc.page.margins.left;
  const width = pageWidth(doc);
  const y = doc.y;
  const photoWidth = Math.min(220, width * 0.42);
  const photoHeight = 280;

  doc.roundedRect(left, y, photoWidth, photoHeight, 12)
    .fillAndStroke(COLORS.forestDeep, COLORS.gold);
  doc.roundedRect(left + 8, y + 8, photoWidth - 16, photoHeight - 45, 8)
    .fill(COLORS.paper);
  try {
    doc.image(photo.buffer, left + 12, y + 12, {
      fit: [photoWidth - 24, photoHeight - 53],
      align: "center",
      valign: "center",
    });
  } catch {
    // Identity facts remain authoritative.
  }
  doc.fillColor(COLORS.goldBright).font("Helvetica-Bold").fontSize(6.2).text(
    "ENCRYPTED FINANCE-VAULT IDENTITY EVIDENCE",
    left + 8,
    y + photoHeight - 26,
    { width: photoWidth - 16, align: "center", lineBreak: false }
  );

  const factX = left + photoWidth + 18;
  const factWidth = width - photoWidth - 18;
  doc.roundedRect(factX, y, factWidth, photoHeight, 12)
    .fillAndStroke(COLORS.paper, COLORS.line);
  doc.rect(factX, y, factWidth, 5).fill(template.accent);
  [
    ["Customer / buyer", customerName(document)],
    ["Phone", agreement.kyc_customer_phone || agreement.customer_phone_snapshot],
    ["Official identification", `${clean(agreement.id_type, "ID")} — ${clean(agreement.id_number)}`],
    ["Address", agreement.residential_address || agreement.customer_address_snapshot],
    ["Agreement", agreement.agreement_number],
  ].forEach(([name, value], index) => {
    const factY = y + 18 + index * 49;
    doc.circle(factX + 18, factY + 8, 6).fill(index % 2 ? COLORS.gold : template.accent);
    doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(5.9).text(
      name.toUpperCase(),
      factX + 32,
      factY,
      { width: factWidth - 42, lineBreak: false, ellipsis: true }
    );
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(8).text(
      clean(value),
      factX + 32,
      factY + 15,
      { width: factWidth - 42, lineGap: 1 }
    );
  });
  doc.y = y + photoHeight + 18;
  drawFactGrid(doc, document, [[
    "Evidence verification",
    `Encrypted photograph ${clean(photo.documentNumber)} • SHA-256 ${clean(photo.checksum, "").slice(0, 34)}…`,
  ]], { columns: 1 });
}

function drawSecuritySeal(doc, document, x, y, diameter = 78) {
  const template = templateFor(document);
  const radius = diameter / 2;
  doc.save();
  doc.circle(x + radius, y + radius, radius).fill(COLORS.gold);
  doc.circle(x + radius, y + radius, radius - 5)
    .lineWidth(1.5).strokeColor(COLORS.goldBright).stroke();
  doc.circle(x + radius, y + radius, radius - 12)
    .fillAndStroke(template.accent, COLORS.champagne);
  drawOfficialLogo(doc, x + 20, y + 20, diameter - 40, diameter - 40, 1);
  doc.fillColor(COLORS.goldBright).font("Helvetica-Bold").fontSize(4.8).text(
    "OFFICIAL • VERIFIED",
    x + 6,
    y + diameter - 14,
    { width: diameter - 12, align: "center", lineBreak: false }
  );
  doc.restore();
}

function drawVerificationPanel(doc, document, qrBuffer) {
  ensureSpace(doc, document, 132);
  const template = templateFor(document);
  const x = doc.page.margins.left;
  const y = doc.y;
  const width = pageWidth(doc);
  const qrSize = 82;
  const sealSize = 72;

  doc.roundedRect(x, y, width, 116, 11).fill(COLORS.forestDeep);
  doc.rect(x, y, 7, 116).fill(COLORS.gold);
  doc.fillColor(COLORS.goldBright).font("Helvetica-Bold").fontSize(8).text(
    "VERIFY THIS OFFICIAL CHALIN 03 DOCUMENT",
    x + 18,
    y + 14,
    { width: width - qrSize - sealSize - 52, lineBreak: false }
  );
  doc.fillColor(COLORS.paper).font("Helvetica").fontSize(6.6).text(
    `Document: ${document.document_number}\nAgreement: ${clean(agreementOf(document).agreement_number)}\nType: ${label(document.document_type)}\nIssued: ${dateTimeLabel(document.issued_at || document.snapshot?.generated_at)}`,
    x + 18,
    y + 35,
    { width: width - qrSize - sealSize - 55, lineGap: 2.1 }
  );
  doc.fillColor("#C7D9D0").font("Helvetica").fontSize(5.5).text(
    `SHA-256 ${clean(document.snapshot_checksum)}`,
    x + 18,
    y + 91,
    { width: width - qrSize - sealSize - 55, lineBreak: false, ellipsis: true }
  );

  const sealX = x + width - qrSize - sealSize - 20;
  drawSecuritySeal(doc, document, sealX, y + 20, sealSize);
  if (qrBuffer) {
    try {
      doc.roundedRect(x + width - qrSize - 8, y + 13, qrSize + 2, qrSize + 2, 5)
        .fill(COLORS.paper);
      doc.image(qrBuffer, x + width - qrSize - 7, y + 14, { fit: [qrSize, qrSize] });
    } catch {
      // Printed verification identity remains available.
    }
  }
  doc.fillColor(COLORS.goldBright).font("Helvetica-Bold").fontSize(5.2).text(
    "SCAN TO VERIFY THIS DOCUMENT ONLINE",
    x + width - qrSize - 14,
    y + 101,
    { width: qrSize + 12, align: "center", lineBreak: false }
  );
  doc.y = y + 126;
}

module.exports = {
  drawIdentityAnnex,
  drawSecuritySeal,
  drawSignatureBlocks,
  drawVerificationPanel,
  writeFlowText,
};
