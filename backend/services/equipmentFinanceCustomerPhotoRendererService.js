const { AsyncLocalStorage } = require("node:async_hooks");

const PDFDocument = require("pdfkit");
const sharp = require("sharp");

const { pool } = require("../config/db");
const {
  decryptDocument,
} = require("./equipmentFinancePrivateDocumentsService");
const {
  renderCompletionPdf: renderBasePdf,
  renderCompletionWord: renderBaseWord,
} = require("./equipmentFinanceCompletionRendererService");

const PHOTO_DOCUMENT_TYPES = new Set([
  "installment_agreement",
  "customer_agreement_copy",
  "company_agreement_copy",
  "boss_approval_pack",
  "guarantor_undertaking",
  "customer_statement",
  "delivery_handover_note",
  "arrears_notice",
  "amendment_agreement",
  "settlement_confirmation",
  "ownership_transfer",
]);
const annexContext = new AsyncLocalStorage();
const PATCH_SYMBOL = Symbol.for("chalin03.finance.customerPhotoPdfPatch");

function text(value, fallback = "Not recorded") {
  const cleaned = String(value ?? "").trim();
  return cleaned || fallback;
}

function money(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function snapshotIdentity(document) {
  const agreement = document.snapshot?.agreement || {};
  return {
    applicationId:
      Number(
        agreement.credit_application_id ||
          agreement.application_id ||
          document.snapshot?.document_context?.application_id ||
          0
      ) || null,
    customerId: Number(agreement.customer_id || 0) || null,
  };
}

async function latestCustomerPhoto(document) {
  if (!PHOTO_DOCUMENT_TYPES.has(document.document_type)) return null;
  const { applicationId, customerId } = snapshotIdentity(document);
  if (!applicationId && !customerId) return null;

  try {
    const conditions = [
      "document.document_type = 'customer_passport_photo'",
      "document.document_status IN ('active','archived')",
    ];
    const values = [];
    if (applicationId && customerId) {
      conditions.push("(document.application_id = ? OR document.customer_id = ?)");
      values.push(applicationId, customerId);
    } else if (applicationId) {
      conditions.push("document.application_id = ?");
      values.push(applicationId);
    } else {
      conditions.push("document.customer_id = ?");
      values.push(customerId);
    }

    const [rows] = await pool.query(
      `SELECT document.*
         FROM equipment_finance_private_documents document
        WHERE ${conditions.join(" AND ")}
        ORDER BY
          CASE WHEN document.application_id = ? THEN 0 ELSE 1 END,
          CASE WHEN document.document_status = 'active' THEN 0 ELSE 1 END,
          document.version_number DESC,
          document.id DESC
        LIMIT 1`,
      [...values, applicationId || -1]
    );
    const row = rows[0];
    if (!row) return null;

    let buffer = decryptDocument(row);
    let mimeType = String(row.mime_type || "").toLowerCase();
    if (mimeType === "image/webp") {
      buffer = await sharp(buffer).png({ compressionLevel: 9 }).toBuffer();
      mimeType = "image/png";
    }
    if (!["image/jpeg", "image/png"].includes(mimeType)) return null;

    return {
      buffer,
      mimeType,
      dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
      documentId: Number(row.id),
      documentNumber: row.document_number,
      checksum: row.content_checksum,
      fileName: row.original_file_name,
    };
  } catch (error) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return null;
    console.error("Finance customer photo document-render warning:", error);
    return null;
  }
}

function pageWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function drawFact(doc, x, y, width, title, value) {
  doc.fillColor("#6b7a71").font("Helvetica").fontSize(7).text(title, x, y, {
    width,
  });
  doc.fillColor("#17251e").font("Helvetica-Bold").fontSize(9).text(text(value), x, y + 11, {
    width,
  });
}

function appendIdentityAnnex(doc, context) {
  const snapshot = context.document.snapshot || {};
  const agreement = snapshot.agreement || {};
  const company = snapshot.company || {};
  const left = doc.page.margins.left;

  doc.addPage();
  const width = pageWidth(doc);
  const top = doc.page.margins.top;

  doc.save().roundedRect(left, top, 46, 46, 8).fill("#d3a72c").restore();
  doc.fillColor("#163523").font("Helvetica-Bold").fontSize(14).text(
    "C03",
    left,
    top + 15,
    { width: 46, align: "center" }
  );
  doc.fillColor("#174f35").font("Helvetica-Bold").fontSize(16).text(
    text(company.name, "CHALIN 03 COMPANY LIMITED"),
    left + 58,
    top + 2,
    { width: width - 58 }
  );
  doc.fillColor("#5e6b64").font("Helvetica").fontSize(7.5).text(
    [company.phone, company.email, company.postal_address || company.address]
      .filter(Boolean)
      .join("  |  "),
    left + 58,
    top + 24,
    { width: width - 58 }
  );
  doc.moveTo(left, top + 56).lineTo(left + width, top + 56).lineWidth(3).strokeColor("#d3a72c").stroke();

  doc.fillColor("#17251e").font("Helvetica-Bold").fontSize(17).text(
    "Customer Identity & Passport Photo",
    left,
    top + 72,
    { width, align: "center" }
  );
  doc.fillColor("#647169").font("Helvetica").fontSize(8).text(
    `${context.document.document_number}  |  Agreement ${text(agreement.agreement_number)}`,
    left,
    top + 96,
    { width, align: "center" }
  );

  const bodyY = top + 128;
  const photoWidth = Math.min(205, width * 0.38);
  const photoHeight = 270;
  doc.save().roundedRect(left, bodyY, photoWidth, photoHeight, 9).fillAndStroke("#f1f5f2", "#b9c8bd").restore();
  doc.image(context.photo.buffer, left + 8, bodyY + 8, {
    fit: [photoWidth - 16, photoHeight - 16],
    align: "center",
    valign: "center",
  });

  const factsX = left + photoWidth + 22;
  const factsWidth = width - photoWidth - 22;
  drawFact(
    doc,
    factsX,
    bodyY + 4,
    factsWidth,
    "CUSTOMER / BUYER",
    agreement.kyc_customer_name || agreement.customer_name_snapshot || agreement.customer_name
  );
  drawFact(
    doc,
    factsX,
    bodyY + 48,
    factsWidth,
    "PHONE NUMBER",
    agreement.kyc_customer_phone || agreement.customer_phone_snapshot
  );
  drawFact(
    doc,
    factsX,
    bodyY + 92,
    factsWidth,
    "OFFICIAL IDENTIFICATION",
    `${text(agreement.id_type, "ID")} - ${text(agreement.id_number)}`
  );
  drawFact(
    doc,
    factsX,
    bodyY + 136,
    factsWidth,
    "RESIDENTIAL / BUSINESS ADDRESS",
    agreement.residential_address || agreement.customer_address_snapshot
  );
  drawFact(
    doc,
    factsX,
    bodyY + 198,
    factsWidth,
    "INSTALLMENT ACCOUNT",
    `${text(agreement.agreement_number)} | Balance ${money(agreement.outstanding_balance)}`
  );

  const evidenceY = bodyY + photoHeight + 24;
  doc.save().roundedRect(left, evidenceY, width, 88, 8).fill("#eef6f0").restore();
  doc.fillColor("#174f35").font("Helvetica-Bold").fontSize(10).text(
    "Protected customer identity evidence",
    left + 14,
    evidenceY + 14,
    { width: width - 28 }
  );
  doc.fillColor("#42564a").font("Helvetica").fontSize(8).text(
    "This full-frame customer photograph is stored in the encrypted Equipment Installment Finance document vault. It is included to support customer identification and does not replace the official Ghana Card, passport or other identification evidence recorded in the KYC file.",
    left + 14,
    evidenceY + 33,
    { width: width - 28, lineGap: 3, align: "justify" }
  );

  doc.fillColor("#6b766f").font("Helvetica").fontSize(6.5).text(
    `Photo evidence ${context.photo.documentNumber} | SHA-256 ${String(
      context.photo.checksum || ""
    ).slice(0, 24)}...`,
    left,
    evidenceY + 102,
    { width, align: "center" }
  );
}

function installPdfPatch() {
  if (PDFDocument.prototype[PATCH_SYMBOL]) return;
  const original = PDFDocument.prototype.bufferedPageRange;
  Object.defineProperty(PDFDocument.prototype, PATCH_SYMBOL, {
    value: true,
    configurable: false,
  });
  PDFDocument.prototype.bufferedPageRange = function patchedBufferedPageRange(...args) {
    const context = annexContext.getStore();
    if (context?.photo && !context.appended) {
      context.appended = true;
      appendIdentityAnnex(this, context);
    }
    return original.apply(this, args);
  };
}

installPdfPatch();

function wordIdentityAnnex(document, photo) {
  const snapshot = document.snapshot || {};
  const agreement = snapshot.agreement || {};
  return `
    <section style="page-break-before:always;border-top:6px solid #d3a72c;padding-top:20px;font-family:Arial,sans-serif;color:#17251e">
      <div style="text-align:center;margin-bottom:18px">
        <h1 style="margin:0;color:#174f35;font-size:24px">${escapeHtml(
          snapshot.company?.name || "CHALIN 03 COMPANY LIMITED"
        )}</h1>
        <h2 style="margin:10px 0 4px;font-size:20px">Customer Identity &amp; Passport Photo</h2>
        <p style="margin:0;color:#647169">${escapeHtml(document.document_number)} | Agreement ${escapeHtml(
          agreement.agreement_number
        )}</p>
      </div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #b9c8bd">
        <tr>
          <td style="width:38%;padding:12px;text-align:center;background:#f1f5f2;vertical-align:top">
            <img src="${photo.dataUrl}" alt="Customer passport photo" style="max-width:220px;max-height:300px;width:auto;height:auto;object-fit:contain" />
          </td>
          <td style="padding:16px;vertical-align:top">
            <p><b>Customer / Buyer</b><br>${escapeHtml(
              agreement.kyc_customer_name || agreement.customer_name_snapshot || agreement.customer_name
            )}</p>
            <p><b>Phone number</b><br>${escapeHtml(
              agreement.kyc_customer_phone || agreement.customer_phone_snapshot
            )}</p>
            <p><b>Official identification</b><br>${escapeHtml(
              `${text(agreement.id_type, "ID")} - ${text(agreement.id_number)}`
            )}</p>
            <p><b>Address</b><br>${escapeHtml(
              agreement.residential_address || agreement.customer_address_snapshot
            )}</p>
            <p><b>Official balance</b><br>${escapeHtml(money(agreement.outstanding_balance))}</p>
          </td>
        </tr>
      </table>
      <div style="margin-top:18px;padding:14px;background:#eef6f0;border:1px solid #c6d9ca">
        <b style="color:#174f35">Protected customer identity evidence</b>
        <p style="margin:7px 0 0;line-height:1.5">This complete customer photograph is stored in the encrypted Equipment Installment Finance document vault and supports the official KYC file.</p>
      </div>
    </section>`;
}

async function renderCompletionPdf(document, options = {}) {
  const photo = await latestCustomerPhoto(document);
  if (!photo) return renderBasePdf(document, options);
  return annexContext.run(
    { document, photo, appended: false },
    () => renderBasePdf(document, options)
  );
}

async function renderCompletionWord(document) {
  const base = renderBaseWord(document).toString("utf8");
  const photo = await latestCustomerPhoto(document);
  if (!photo) return Buffer.from(base, "utf8");
  const annex = wordIdentityAnnex(document, photo);
  const html = base.includes("</body>")
    ? base.replace("</body>", `${annex}</body>`)
    : `${base}${annex}`;
  return Buffer.from(html, "utf8");
}

module.exports = {
  PHOTO_DOCUMENT_TYPES,
  latestCustomerPhoto,
  renderCompletionPdf,
  renderCompletionWord,
};
