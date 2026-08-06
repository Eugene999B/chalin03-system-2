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
      margins: { top: 14, bottom: 18, left: 12, right: 12 },
      autoFirstPage: true,
      bufferPages: true,
      info: { Title: templateFor(document).title, Author: "Chalin 03 Company Limited" },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      drawOfficialLogo(doc, 83, 13, 60, 60);
      doc.y = 80;
      doc.fillColor(COLORS.navy).font("Helvetica-Bold").fontSize(9).text(
        "CHALIN 03 COMPANY LIMITED",
        { align: "center" }
      );
      doc.fillColor(COLORS.emerald).font("Helvetica-Bold").fontSize(8.5).text(
        "OFFICIAL PAYMENT RECEIPT",
        { align: "center" }
      );
      doc.moveDown(0.4);
      doc.font("Helvetica-Bold").fontSize(14).fillColor(COLORS.ink).text(
        money(payment.amount),
        { align: "center" }
      );
      doc.moveDown(0.5);
      [
        ["Receipt", payment.receipt_number || payment.payment_number],
        ["Customer", customerName(document)],
        ["Agreement", agreement.agreement_number],
        ["Machine", machineName(document)],
        ["Date", dateTimeLabel(payment.payment_date)],
        ["Method", label(payment.payment_method)],
        ["Reference", payment.reference_number || "-"],
        ["Balance", money(agreement.outstanding_balance)],
      ].forEach(([name, value]) => {
        doc.font("Helvetica-Bold").fontSize(6.6).fillColor(COLORS.ink).text(
          `${name}: `,
          { continued: true }
        );
        doc.font("Helvetica").text(clean(value, ""));
      });
      doc.moveDown(0.5).font("Helvetica-Bold").text("ALLOCATION", { align: "center" });
      (snapshot.document_context?.payment_allocations || []).forEach((row) => {
        doc.font("Helvetica").fontSize(6.3).text(
          `Installment ${row.sequence_number}: ${money(row.allocated_amount)}`,
          { align: "center" }
        );
      });
      doc.moveDown(0.5);
      doc.image(qr, 83, doc.y, { fit: [60, 60] });
      doc.y += 65;
      doc.font("Helvetica-Bold").fontSize(6).fillColor(COLORS.emerald).text(
        "SYSTEM-GENERATED • TAMPER-EVIDENT",
        { align: "center" }
      );
      doc.font("Helvetica").fontSize(5.3).fillColor(COLORS.muted).text(
        `${document.document_number}\n${clean(document.snapshot_checksum, "").slice(0, 28)}`,
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
      color: { dark: `${COLORS.navy}ff`, light: "#ffffffff" },
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
        Keywords: "Chalin 03, Equipment Installment Finance, tamper-evident",
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
