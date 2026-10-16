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
  margins: { top: 34, bottom: 58, left: 38, right: 38 },
});
const BODY_TOP = 176;
const FOOTER_GAP = 44;

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

function drawOfficialLogo(doc, x, y, width = 72, height = 72, opacity = 1) {
  const logoPath = findOfficialLogoPath();
  if (!logoPath) return false;
  doc.save().opacity(opacity);
  try {
    doc.image(logoPath, x, y, {
      fit: [width, height],
      align: "center",
      valign: "center",
    });
    doc.restore();
    return true;
  } catch (error) {
    doc.restore();
    console.error("Finance document official-logo render warning:", error.message);
    return false;
  }
}

function drawGuilloche(doc, template) {
  const width = doc.page.width;
  doc.save().opacity(0.12).lineWidth(0.35).strokeColor(COLORS.goldBright);
  for (let offset = -50; offset < width + 80; offset += 24) {
    doc.moveTo(offset, 8)
      .bezierCurveTo(offset + 54, 38, offset + 30, 88, offset + 92, 122)
      .stroke();
  }
  doc.restore();

  doc.save().opacity(0.055).strokeColor(template.accent).lineWidth(0.45);
  for (let y = 205; y < doc.page.height - 72; y += 74) {
    doc.moveTo(doc.page.width - 112, y)
      .lineTo(doc.page.width - 44, y + 34)
      .lineTo(doc.page.width - 112, y + 68)
      .stroke();
  }
  doc.restore();
}

function drawBrandWave(doc, template) {
  const width = doc.page.width;
  doc.save();
  doc.rect(0, 0, width, 112).fill(COLORS.forestDeep);
  doc.moveTo(0, 88)
    .bezierCurveTo(width * 0.3, 142, width * 0.68, 56, width, 105)
    .lineTo(width, 0)
    .lineTo(0, 0)
    .closePath()
    .fill(template.accent === COLORS.red ? COLORS.red : COLORS.forest);
  doc.moveTo(0, 103)
    .bezierCurveTo(width * 0.32, 151, width * 0.7, 73, width, 116)
    .lineWidth(4)
    .strokeColor(COLORS.gold)
    .stroke();
  doc.moveTo(0, 109)
    .bezierCurveTo(width * 0.34, 153, width * 0.72, 83, width, 120)
    .lineWidth(0.7)
    .strokeColor(COLORS.goldBright)
    .stroke();
  doc.restore();
}

function drawWatermark(doc, document) {
  const template = templateFor(document);
  const centreX = doc.page.width / 2;
  const centreY = doc.page.height / 2 + 28;

  drawOfficialLogo(doc, centreX - 145, centreY - 145, 290, 290, 0.038);

  doc.save();
  doc.strokeColor(template.accent).opacity(0.035).lineWidth(2.2);
  doc.moveTo(centreX, centreY - 168)
    .lineTo(centreX + 168, centreY)
    .lineTo(centreX, centreY + 168)
    .lineTo(centreX - 168, centreY)
    .closePath()
    .stroke();
  doc.moveTo(centreX, centreY - 142)
    .lineTo(centreX + 142, centreY)
    .lineTo(centreX, centreY + 142)
    .lineTo(centreX - 142, centreY)
    .closePath()
    .stroke();
  doc.restore();

  doc.save();
  doc.fillColor(template.accent).fillOpacity(0.048);
  doc.font("Times-Bold").fontSize(template.family === "certificate" ? 55 : 41);
  safeAbsoluteText(doc, template.watermark, centreX - 255, centreY + 116, {
    width: 510,
    align: "center",
  });
  doc.restore();
}

function drawCertificateFrame(doc, template) {
  doc.save();
  doc.rect(14, 14, doc.page.width - 28, doc.page.height - 28)
    .lineWidth(2.2)
    .strokeColor(template.accent)
    .stroke();
  doc.rect(22, 22, doc.page.width - 44, doc.page.height - 44)
    .lineWidth(0.85)
    .strokeColor(COLORS.gold)
    .stroke();
  [[29, 29], [doc.page.width - 55, 29], [29, doc.page.height - 55], [doc.page.width - 55, doc.page.height - 55]].forEach(([x, y]) => {
    doc.roundedRect(x, y, 26, 26, 4).lineWidth(0.8).strokeColor(COLORS.gold).stroke();
    doc.moveTo(x + 5, y + 13).lineTo(x + 21, y + 13).stroke();
    doc.moveTo(x + 13, y + 5).lineTo(x + 13, y + 21).stroke();
  });
  doc.restore();
}

function drawHeader(doc, document) {
  const template = templateFor(document);
  const snapshot = document.snapshot || {};
  const agreement = agreementOf(document);
  const left = doc.page.margins.left;
  const width = pageWidth(doc);

  drawBrandWave(doc, template);
  drawGuilloche(doc, template);

  const logoDrawn = drawOfficialLogo(doc, left + 2, 20, 72, 72);
  const brandX = logoDrawn ? left + 86 : left;
  const brandWidth = 260;
  doc.fillColor(COLORS.paper).font("Times-Bold").fontSize(18).text(
    clean(snapshot.company?.name, "CHALIN 03 COMPANY LIMITED"),
    brandX,
    28,
    { width: brandWidth, lineBreak: false, ellipsis: true }
  );
  doc.fillColor(COLORS.goldBright).font("Helvetica-Bold").fontSize(7.2).text(
    "EQUIPMENT  •  FINANCE  •  TRUST",
    brandX,
    56,
    { width: brandWidth, characterSpacing: 1.2, lineBreak: false }
  );
  doc.fillColor("#D8E5DE").font("Helvetica").fontSize(6.2).text(
    [snapshot.company?.phone, snapshot.company?.email]
      .filter(Boolean)
      .join("  •  "),
    brandX,
    75,
    { width: brandWidth, lineBreak: false, ellipsis: true }
  );

  const metaWidth = 152;
  const metaX = doc.page.width - doc.page.margins.right - metaWidth;
  doc.roundedRect(metaX, 22, metaWidth, 66, 9)
    .fillAndStroke("#073429", COLORS.gold);
  doc.fillColor(COLORS.goldBright).font("Helvetica-Bold").fontSize(5.8).text(
    "DOCUMENT NUMBER",
    metaX + 10,
    31,
    { width: metaWidth - 20, align: "right", lineBreak: false }
  );
  doc.fillColor(COLORS.paper).font("Helvetica-Bold").fontSize(7.5).text(
    clean(document.document_number),
    metaX + 10,
    43,
    { width: metaWidth - 20, align: "right", lineBreak: false, ellipsis: true }
  );
  doc.fillColor(COLORS.goldBright).font("Helvetica-Bold").fontSize(5.8).text(
    "AGREEMENT",
    metaX + 10,
    61,
    { width: metaWidth - 20, align: "right", lineBreak: false }
  );
  doc.fillColor(COLORS.paper).font("Helvetica").fontSize(6.8).text(
    clean(agreement.agreement_number),
    metaX + 10,
    73,
    { width: metaWidth - 20, align: "right", lineBreak: false, ellipsis: true }
  );

  const titleY = 122;
  doc.fillColor(template.accent).font("Times-Bold").fontSize(
    template.title.length > 31 ? 15.5 : 18
  ).text(template.title, left, titleY, {
    width,
    align: "center",
    lineBreak: false,
  });
  doc.fillColor(COLORS.goldDark).font("Helvetica-Bold").fontSize(6.6).text(
    template.subtitle.toUpperCase(),
    left,
    titleY + 25,
    { width, align: "center", characterSpacing: 1.2, lineBreak: false }
  );

  const badgeWidth = Math.min(146, Math.max(92, template.classification.length * 6.1));
  const badgeX = left + (width - badgeWidth) / 2;
  doc.roundedRect(badgeX, titleY + 43, badgeWidth, 17, 8).fill(template.accent);
  doc.fillColor(COLORS.paper).font("Helvetica-Bold").fontSize(5.8).text(
    template.classification,
    badgeX,
    titleY + 49,
    { width: badgeWidth, align: "center", lineBreak: false }
  );
}

function addPage(doc, document) {
  doc.addPage(A4);
  const template = templateFor(document);
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLORS.ivory);
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
    const y = doc.page.height - 34;
    doc.rect(0, y - 5, doc.page.width, 39).fill(COLORS.forestDeep);
    doc.rect(0, y - 6, doc.page.width, 2).fill(COLORS.gold);
    doc.fillColor(COLORS.goldBright).font("Helvetica-Bold").fontSize(5.5);
    safeAbsoluteText(
      doc,
      "SECURE • VERIFIED • SYSTEM-GENERATED",
      doc.page.margins.left,
      y + 5,
      { width: 170, align: "left" }
    );
    doc.fillColor("#D6E3DC").font("Helvetica").fontSize(5.1);
    safeAbsoluteText(
      doc,
      `${document.document_number}  |  SHA ${clean(document.snapshot_checksum, "").slice(0, 20)}…`,
      doc.page.margins.left + 170,
      y + 5,
      { width: doc.page.width - 340, align: "center" }
    );
    doc.fillColor(COLORS.goldBright).font("Helvetica-Bold").fontSize(5.5);
    safeAbsoluteText(
      doc,
      `PAGE ${index + 1} OF ${range.count}`,
      doc.page.width - doc.page.margins.right - 95,
      y + 5,
      { width: 95, align: "right" }
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