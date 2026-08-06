const {
  COLORS,
  agreementOf,
  clean,
  dataImage,
  findOfficialLogoPath,
  templateFor,
} = require("./equipmentFinanceDocumentDesignV2Service");

const A4 = Object.freeze({
  size: "A4",
  margins: { top: 38, bottom: 62, left: 44, right: 44 },
});
const BODY_TOP = 144;
const FOOTER_GAP = 48;

function pageWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function bodyBottom(doc) {
  return doc.page.height - doc.page.margins.bottom - FOOTER_GAP;
}

function safeAbsoluteText(doc, value, x, y, options = {}) {
  const oldBottom = doc.page.margins.bottom;
  const oldX = doc.x;
  const oldY = doc.y;
  doc.page.margins.bottom = 0;
  try {
    doc.text(String(value ?? ""), x, y, { lineBreak: false, ...options });
  } finally {
    doc.page.margins.bottom = oldBottom;
    doc.x = oldX;
    doc.y = oldY;
  }
}

function imageBuffer(value) {
  return Buffer.isBuffer(value) ? value : dataImage(value);
}

function primaryMachineImage(document) {
  const snapshot = document.snapshot || {};
  return imageBuffer(
    snapshot.media?.find((item) => item.evidence_type === "main")?.file_url ||
      snapshot.media?.find((item) => item.is_primary)?.file_url ||
      snapshot.agreement?.main_image_url
  );
}

function drawOfficialLogo(doc, x, y, width = 66, height = 66) {
  const logoPath = findOfficialLogoPath();
  if (!logoPath) return false;
  try {
    doc.image(logoPath, x, y, { fit: [width, height], align: "center", valign: "center" });
    return true;
  } catch (error) {
    console.error("Finance document official-logo render warning:", error.message);
    return false;
  }
}

function drawWatermark(doc, document) {
  const template = templateFor(document);
  const centreX = doc.page.width / 2;
  const centreY = doc.page.height / 2 + 18;
  const logoPath = findOfficialLogoPath();

  if (logoPath) {
    doc.save().opacity(0.045);
    try {
      doc.image(logoPath, centreX - 125, centreY - 125, {
        fit: [250, 250], align: "center", valign: "center",
      });
    } catch {
      // The text watermark remains visible.
    }
    doc.restore();
  }

  doc.save();
  doc.fillColor(template.accent).fillOpacity(0.115);
  doc.font("Helvetica-Bold").fontSize(template.family === "certificate" ? 48 : 42);
  doc.rotate(-32, { origin: [centreX, centreY] });
  safeAbsoluteText(doc, template.watermark, centreX - 310, centreY - 22, {
    width: 620, align: "center",
  });
  doc.restore();
}

function drawCertificateFrame(doc, template) {
  doc.save();
  doc.rect(16, 16, doc.page.width - 32, doc.page.height - 32)
    .lineWidth(2.2).strokeColor(template.accent).stroke();
  doc.rect(24, 24, doc.page.width - 48, doc.page.height - 48)
    .lineWidth(0.8).strokeColor(COLORS.gold).stroke();
  doc.restore();
}

function drawHeader(doc, document) {
  const template = templateFor(document);
  const snapshot = document.snapshot || {};
  const agreement = agreementOf(document);
  const left = doc.page.margins.left;
  const width = pageWidth(doc);
  const top = doc.page.margins.top;

  doc.rect(0, 0, doc.page.width, 17).fill(COLORS.navy);
  doc.rect(0, 17, doc.page.width, 5).fill(COLORS.gold);
  drawOfficialLogo(doc, left, top, 66, 66);

  const textX = left + 81;
  const textWidth = width - 81;
  doc.fillColor(COLORS.navy).font("Helvetica-Bold").fontSize(17).text(
    clean(snapshot.company?.name, "CHALIN 03 COMPANY LIMITED"),
    textX, top + 1,
    { width: textWidth, align: "center", lineBreak: false }
  );
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(7.6).text(
    [snapshot.company?.phone, snapshot.company?.email, snapshot.company?.postal_address || snapshot.company?.address]
      .filter(Boolean).join("  •  "),
    textX, top + 25,
    { width: textWidth, align: "center", lineBreak: false }
  );

  const badgeWidth = Math.min(145, Math.max(95, template.classification.length * 6.2));
  const badgeX = doc.page.width - doc.page.margins.right - badgeWidth;
  doc.roundedRect(badgeX, top + 42, badgeWidth, 20, 4).fill(template.accent);
  doc.fillColor(COLORS.paper).font("Helvetica-Bold").fontSize(7).text(
    template.classification, badgeX, top + 48,
    { width: badgeWidth, align: "center", lineBreak: false }
  );

  const titleY = top + 76;
  doc.moveTo(left, titleY - 7).lineTo(left + width, titleY - 7)
    .lineWidth(1.2).strokeColor(COLORS.gold).stroke();
  doc.fillColor(template.accent).font("Helvetica-Bold").fontSize(15.5).text(
    template.title, left, titleY,
    { width, align: "center", lineBreak: false }
  );
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(7.3).text(
    `${template.subtitle}  •  ${document.document_number}  •  Agreement ${clean(agreement.agreement_number)}`,
    left, titleY + 21,
    { width, align: "center", lineBreak: false }
  );
}

function addPage(doc, document) {
  doc.addPage(A4);
  const template = templateFor(document);
  if (template.family === "certificate") drawCertificateFrame(doc, template);
  drawWatermark(doc, document);
  drawHeader(doc, document);
  doc.x = doc.page.margins.left;
  doc.y = BODY_TOP;
}

function ensureSpace(doc, document, height) {
  if (doc.y + height > bodyBottom(doc)) addPage(doc, document);
}

function drawFooters(doc, document) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const left = doc.page.margins.left;
    const width = pageWidth(doc);
    const y = doc.page.height - 42;
    doc.moveTo(left, y - 7).lineTo(left + width, y - 7)
      .lineWidth(0.55).strokeColor(COLORS.gold).stroke();
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(5.8);
    safeAbsoluteText(
      doc,
      `CHALIN 03 COMPANY LIMITED | SYSTEM-GENERATED • TAMPER-EVIDENT | ${document.document_number} | SHA ${clean(document.snapshot_checksum, "").slice(0, 18)} | Page ${index + 1} of ${range.count}`,
      left, y,
      { width, align: "center" }
    );
  }
}

module.exports = {
  A4,
  BODY_TOP,
  addPage,
  bodyBottom,
  drawFooters,
  drawOfficialLogo,
  ensureSpace,
  imageBuffer,
  pageWidth,
  primaryMachineImage,
  safeAbsoluteText,
};
