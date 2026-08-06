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
  ensureSpace,
  imageBuffer,
  pageWidth,
} = require("./equipmentFinancePdfV2PageService");
const {
  drawFactGrid,
  sectionTitle,
} = require("./equipmentFinancePdfV2BasicWidgetService");

function writeFlowText(doc, document, value, options = {}) {
  const text = clean(value, "");
  if (!text) return;
  const width = options.width || pageWidth(doc);
  const x = options.x || doc.page.margins.left;
  const font = options.bold ? "Helvetica-Bold" : options.font || "Helvetica";
  const size = options.size || 8.7;
  const color = options.color || COLORS.ink;
  const lineGap = options.lineGap ?? 2;
  const paragraphGap = options.paragraphGap ?? 7;
  const paragraphs = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);

  paragraphs.forEach((paragraph) => {
    let words = paragraph.split(/\s+/);
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
      doc.fillColor(color).font(font).fontSize(size).text(
        words.slice(0, fit).join(" "),
        x,
        doc.y,
        { width, lineGap, align: options.align || "justify", paragraphGap: 0 }
      );
      words = words.slice(fit);
      if (words.length) addPage(doc, document);
    }
    doc.y += paragraphGap;
  });
}

function drawSignatureBlocks(doc, document, roles) {
  sectionTitle(doc, document, "Execution and signatures");
  const snapshot = document.snapshot || {};
  const left = doc.page.margins.left;
  const width = pageWidth(doc);
  const gap = 14;
  const columnWidth = (width - gap) / 2;

  for (let index = 0; index < roles.length; index += 2) {
    ensureSpace(doc, document, 102);
    const y = doc.y;
    roles.slice(index, index + 2).forEach(([role, title], columnIndex) => {
      const x = left + columnIndex * (columnWidth + gap);
      const record = snapshot.signatures?.find((item) => item.signer_role === role);
      const fallback = role === "seller" ? snapshot.company?.authorised_seller_signature_data_url : null;
      const signature = imageBuffer(record?.signature_data_url || fallback);
      doc.roundedRect(x, y, columnWidth, 88, 6).fillAndStroke(COLORS.paper, COLORS.line);
      doc.fillColor(templateFor(document).accent).font("Helvetica-Bold").fontSize(7.3).text(
        title.toUpperCase(), x + 10, y + 9,
        { width: columnWidth - 20, lineBreak: false }
      );
      if (signature) {
        try {
          doc.image(signature, x + 10, y + 24, { fit: [columnWidth - 20, 30] });
        } catch {
          // The signature line remains available.
        }
      }
      doc.moveTo(x + 10, y + 61).lineTo(x + columnWidth - 10, y + 61)
        .lineWidth(0.5).strokeColor(COLORS.muted).stroke();
      doc.fillColor(COLORS.ink).font("Helvetica").fontSize(6.7).text(
        clean(
          record?.signer_name ||
            (role === "seller" ? snapshot.company?.authorised_seller_name : ""),
          "Name / signature"
        ),
        x + 10, y + 68,
        { width: columnWidth - 20, align: "center", lineBreak: false }
      );
    });
    doc.y = y + 97;
  }
}

function drawIdentityAnnex(doc, document, photo) {
  if (!photo || !PHOTO_DOCUMENT_TYPES.has(document.document_type)) return;
  addPage(doc, document);
  sectionTitle(doc, document, "Protected customer identity annex");
  const agreement = agreementOf(document);
  const left = doc.page.margins.left;
  const width = pageWidth(doc);
  const y = doc.y;
  const photoWidth = Math.min(205, width * 0.4);
  const photoHeight = 265;
  doc.roundedRect(left, y, photoWidth, photoHeight, 9).fillAndStroke(COLORS.ash, COLORS.line);
  try {
    doc.image(photo.buffer, left + 8, y + 8, {
      fit: [photoWidth - 16, photoHeight - 16],
      align: "center",
      valign: "center",
    });
  } catch {
    // Identity data remains available beside the photo frame.
  }
  const factX = left + photoWidth + 20;
  const factWidth = width - photoWidth - 20;
  [
    ["Customer / buyer", customerName(document)],
    ["Phone", agreement.kyc_customer_phone || agreement.customer_phone_snapshot],
    ["Official identification", `${clean(agreement.id_type, "ID")} — ${clean(agreement.id_number)}`],
    ["Address", agreement.residential_address || agreement.customer_address_snapshot],
    ["Agreement", agreement.agreement_number],
  ].forEach(([name, value], index) => {
    const factY = y + index * 49;
    doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(6.2).text(
      name.toUpperCase(), factX, factY,
      { width: factWidth, lineBreak: false }
    );
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(8.4).text(
      clean(value), factX, factY + 14,
      { width: factWidth, lineGap: 1 }
    );
  });
  doc.y = y + photoHeight + 18;
  drawFactGrid(doc, document, [[
    "Evidence verification",
    `Encrypted Finance-vault photograph ${clean(photo.documentNumber)} • SHA-256 ${clean(
      photo.checksum,
      ""
    ).slice(0, 28)}…`,
  ]], { columns: 1 });
}

function drawVerificationPanel(doc, document, qrBuffer) {
  ensureSpace(doc, document, 118);
  const template = templateFor(document);
  const x = doc.page.margins.left;
  const y = doc.y;
  const width = pageWidth(doc);
  doc.roundedRect(x, y, width, 102, 8).fillAndStroke(COLORS.ash, COLORS.line);
  doc.fillColor(template.accent).font("Helvetica-Bold").fontSize(8).text(
    "DOCUMENT AUTHENTICITY & TAMPER-EVIDENT VERIFICATION",
    x + 12, y + 12,
    { width: width - 100, lineBreak: false }
  );
  doc.fillColor(COLORS.ink).font("Helvetica").fontSize(6.8).text(
    `Document: ${document.document_number}\nAgreement: ${clean(
      agreementOf(document).agreement_number
    )}\nType: ${label(document.document_type)}\nIssued: ${dateTimeLabel(
      document.issued_at || document.snapshot?.generated_at
    )}\nSHA-256: ${clean(document.snapshot_checksum)}`,
    x + 12, y + 30,
    { width: width - 105, lineGap: 2 }
  );
  if (qrBuffer) {
    try {
      doc.image(qrBuffer, x + width - 82, y + 11, { fit: [72, 72] });
    } catch {
      // Text verification remains present.
    }
  }
  doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(5.8).text(
    "SCAN OR MATCH THE QR IDENTITY WITH THE PRINTED DOCUMENT NUMBER AND CHECKSUM.",
    x + 12, y + 84,
    { width: width - 24, align: "center", lineBreak: false }
  );
  doc.y = y + 111;
}

module.exports = {
  drawIdentityAnnex,
  drawSignatureBlocks,
  drawVerificationPanel,
  writeFlowText,
};
