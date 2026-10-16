const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");

const {
  latestCustomerPhoto,
} = require("./equipmentFinanceCustomerPhotoRendererService");
const {
  COLORS,
  DOCUMENT_TEMPLATES,
  agreementOf,
  clean,
  customerName,
  dateTimeLabel,
  label,
  machineName,
  money,
  templateFor,
  verificationPayload,
} = require("./equipmentFinanceDocumentDesignV2Service");
const {
  addPage,
  drawFooters,
  drawOfficialLogo,
  safeAbsoluteText,
} = require("./equipmentFinancePdfV2PageService");
const {
  drawIdentityAnnex,
  drawVerificationPanel,
} = require("./equipmentFinancePdfV2FlowWidgetService");
const {
  renderExecutivePack,
  renderLegalAgreement,
  renderReceipt,
  renderSchedule,
  renderStatement,
} = require("./equipmentFinancePdfV2AccountBodies");
const {
  renderAmendment,
  renderArrears,
  renderCertificate,
  renderGuarantor,
  renderHandover,
  renderMachineAnnexure,
} = require("./equipmentFinancePdfV2LifecycleBodies");
const {
  renderCompletionWord,
} = require("./equipmentFinanceDocumentWordV2Service");

function renderBody(doc, document) {
  switch (templateFor(document).family) {
    case "legal":
      return renderLegalAgreement(doc, document);
    case "executive":
      return renderExecutivePack(doc, document);
    case "receipt":
      return renderReceipt(doc, document);
    case "schedule":
      return renderSchedule(doc, document);
    case "statement":
      return renderStatement(doc, document);
    case "evidence":
      return renderMachineAnnexure(doc, document);
    case "undertaking":
      return renderGuarantor(doc, document);
    case "handover":
      return renderHandover(doc, document);
    case "notice":
      return renderArrears(doc, document);
    case "amendment":
      return renderAmendment(doc, document);
    case "certificate":
      return renderCertificate(doc, document);
    default:
      return renderLegalAgreement(doc, document);
  }
}

async function renderThermalReceipt(document) {
  const snapshot = document.snapshot || {};
  const agreement = agreementOf(document);
  const payment = snapshot.document_context?.payment || {};
  const qr = await QRCode.toBuffer(verificationPayload(document), {
    type: "png",
    width: 180,
    margin: 1,
    errorCorrectionLevel: "M",
  });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [226.77, 620],
      margins: { top: 12, bottom: 18, left: 12, right: 12 },
      autoFirstPage: false,
      bufferPages: true,
      info: {
        Title: templateFor(document).title,
        Author: "Chalin 03 Company Limited",
        Keywords: "Chalin 03, secure receipt, logo-led-v3",
      },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      doc.addPage({ size: [226.77, 620], margins: { top: 12, bottom: 18, left: 12, right: 12 } });
      doc.rect(0, 0, doc.page.width, 93).fill(COLORS.forestDeep);
      doc.rect(0, 91, doc.page.width, 4).fill(COLORS.gold);
      drawOfficialLogo(doc, 83, 12, 60, 60);
      doc.fillColor(COLORS.goldBright).font("Helvetica-Bold").fontSize(7).text(
        "CHALIN 03 COMPANY LIMITED",
        14,
        72,
        { width: doc.page.width - 28, align: "center", lineBreak: false }
      );
      doc.y = 106;
      doc.fillColor(COLORS.forest).font("Times-Bold").fontSize(11).text(
        "OFFICIAL PAYMENT RECEIPT",
        { align: "center" }
      );
      doc.moveDown(0.5);
      doc.roundedRect(18, doc.y, doc.page.width - 36, 76, 8).fill(COLORS.forestDeep);
      const amountY = doc.y;
      doc.fillColor(COLORS.goldBright).font("Helvetica-Bold").fontSize(6.5).text(
        "AMOUNT PAID",
        18,
        amountY + 12,
        { width: doc.page.width - 36, align: "center", lineBreak: false }
      );
      doc.fillColor(COLORS.paper).font("Times-Bold").fontSize(16).text(
        money(payment.amount),
        18,
        amountY + 31,
        { width: doc.page.width - 36, align: "center", lineBreak: false }
      );
      doc.y = amountY + 88;
      [
        ["Receipt", payment.receipt_number || payment.payment_number],
        ["Customer", customerName(document)],
        ["Agreement", agreement.agreement_number],
        ["Machine", machineName(document)],
        ["Date", dateTimeLabel(payment.payment_date)],
        ["Method", label(payment.payment_method)],
        ["Reference", payment.reference_number || "-"],
        ["Balance", money(agreement.outstanding_balance)],
      ].forEach(([name, value], index) => {
        const y = doc.y;
        if (index % 2 === 0) doc.rect(14, y - 2, doc.page.width - 28, 19).fill(COLORS.ash);
        doc.font("Helvetica-Bold").fontSize(6).fillColor(COLORS.forest).text(
          `${name}: `,
          18,
          y + 3,
          { width: 48, continued: false, lineBreak: false }
        );
        doc.font("Helvetica").fillColor(COLORS.ink).text(
          clean(value, ""),
          66,
          y + 3,
          { width: doc.page.width - 84, lineBreak: false, ellipsis: true }
        );
        doc.y = y + 19;
      });
      doc.moveDown(0.4).font("Helvetica-Bold").fillColor(COLORS.goldDark).text(
        "ALLOCATION",
        { align: "center" }
      );
      (snapshot.document_context?.payment_allocations || []).forEach((row) => {
        doc.font("Helvetica").fontSize(6.1).fillColor(COLORS.ink).text(
          `Installment ${row.sequence_number}: ${money(row.allocated_amount)}`,
          { align: "center" }
        );
      });
      doc.moveDown(0.5);
      doc.image(qr, 83, doc.y, { fit: [60, 60] });
      doc.y += 66;
      doc.font("Helvetica-Bold").fontSize(5.8).fillColor(COLORS.forest).text(
        "SECURE • VERIFIED • SYSTEM-GENERATED",
        { align: "center" }
      );
      doc.font("Helvetica").fontSize(5.1).fillColor(COLORS.muted).text(
        `${document.document_number}\n${clean(document.snapshot_checksum, "").slice(0, 30)}`,
        { align: "center" }
      );
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

async function renderCompletionPdf(document, { layout = "a4" } = {}) {
  if (layout === "thermal" && document.document_type === "payment_receipt") {
    return renderThermalReceipt(document);
  }

  const [qrBuffer, photo] = await Promise.all([
    QRCode.toBuffer(verificationPayload(document), {
      type: "png",
      width: 260,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: `${COLORS.forestDeep}ff`, light: "#ffffffff" },
    }),
    latestCustomerPhoto(document),
  ]);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      autoFirstPage: false,
      bufferPages: true,
      compress: true,
      info: {
        Title: templateFor(document).title,
        Author: clean(document.snapshot?.company?.name, "Chalin 03 Company Limited"),
        Subject: `${document.document_number} • ${templateFor(document).classification}`,
        Keywords: "Chalin 03, Equipment Installment Finance, official logo, logo-led-v3, tamper-evident",
      },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      addPage(doc, document);
      renderBody(doc, document);
      drawIdentityAnnex(doc, document, photo);
      drawVerificationPanel(doc, document, qrBuffer);
      drawFooters(doc, document);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = {
  DOCUMENT_TEMPLATES,
  renderCompletionPdf,
  renderCompletionWord,
  safeAbsoluteText,
};
