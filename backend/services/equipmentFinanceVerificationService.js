const crypto = require("node:crypto");

const { pool } = require("../config/db");

const TOKEN_NAMESPACE = "CHALIN03-FINANCE-DOCUMENT-VERIFICATION-V1";
const PUBLIC_ORIGIN = "https://chalin03.com";

const DOCUMENT_TITLES = Object.freeze({
  installment_agreement: "Installment Sale Agreement",
  customer_agreement_copy: "Installment Sale Agreement — Customer Copy",
  company_agreement_copy: "Installment Sale Agreement — Company Copy",
  boss_approval_pack: "Executive Finance Approval Pack",
  payment_schedule: "Official Installment Payment Schedule",
  machine_annexure: "Machine Identity Annexure",
  guarantor_undertaking: "Guarantor Undertaking",
  payment_receipt: "Official Installment Payment Receipt",
  customer_statement: "Customer Installment Statement",
  delivery_handover_note: "Delivery & Handover Note",
  arrears_notice: "Formal Arrears Notice",
  amendment_agreement: "Installment Agreement Amendment",
  settlement_confirmation: "Full Settlement Confirmation",
  ownership_transfer: "Equipment Ownership Transfer Certificate",
});

class FinanceVerificationError extends Error {
  constructor(statusCode, message, code = "FINANCE_DOCUMENT_VERIFICATION_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function parseJson(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

function validChecksum(value) {
  return /^[a-f0-9]{64}$/.test(cleanText(value, 64).toLowerCase());
}

function tokenSource(document) {
  return [
    TOKEN_NAMESPACE,
    positiveId(document?.id) || 0,
    cleanText(document?.document_number, 100),
    cleanText(document?.snapshot_checksum, 64).toLowerCase(),
  ].join(":");
}

function verificationToken(document) {
  if (
    !positiveId(document?.id) ||
    !document?.document_number ||
    !validChecksum(document?.snapshot_checksum)
  ) {
    return "";
  }
  return sha256(tokenSource(document));
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verificationUrl(document) {
  const token = verificationToken(document);
  const id = positiveId(document?.id);
  if (!id || !token) return "";
  return `${PUBLIC_ORIGIN}/api/finance-verification/${id}/${token}`;
}

function maskName(value) {
  const parts = cleanText(value, 180).split(/\s+/).filter(Boolean);
  if (!parts.length) return "Customer";
  if (parts.length === 1) {
    const name = parts[0];
    return name.length <= 2
      ? `${name[0] || ""}•`
      : `${name.slice(0, 2)}${"•".repeat(Math.min(6, Math.max(2, name.length - 2)))}`;
  }
  return [parts[0], ...parts.slice(1).map((part) => `${part[0] || ""}.`)].join(" ");
}

function maskPhone(value) {
  const digits = cleanText(value, 40).replace(/\D/g, "");
  if (!digits) return "Not published";
  return `••••••${digits.slice(-4)}`;
}

function maskSerial(value) {
  const text = cleanText(value, 120);
  if (!text) return "Not published";
  if (text.length <= 6) return text;
  return `${"•".repeat(Math.min(8, text.length - 6))}${text.slice(-6)}`;
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : null;
}

function documentTitle(type) {
  return (
    DOCUMENT_TITLES[type] ||
    cleanText(type, 80).replaceAll("_", " ") ||
    "Finance Document"
  );
}

function safeFinancialFacts(documentType, snapshot) {
  const agreement = snapshot?.agreement || {};
  const context = snapshot?.document_context || {};
  const payment = context?.payment || {};
  const facts = [];

  if (documentType === "payment_receipt") {
    const amount = numberValue(payment.amount);
    if (amount !== null) facts.push({ label: "Payment amount", amount });
    if (payment.receipt_number || payment.payment_number) {
      facts.push({
        label: "Receipt",
        value: payment.receipt_number || payment.payment_number,
        kind: "text",
      });
    }
    if (payment.payment_date) {
      facts.push({ label: "Payment date", value: payment.payment_date, kind: "date" });
    }
    return facts;
  }

  if (
    [
      "installment_agreement",
      "customer_agreement_copy",
      "company_agreement_copy",
      "payment_schedule",
    ].includes(documentType)
  ) {
    const total = numberValue(agreement.total_amount);
    const financed = numberValue(agreement.financed_amount);
    if (total !== null) facts.push({ label: "Agreement total", amount: total });
    if (financed !== null) facts.push({ label: "Financed amount", amount: financed });
    if (agreement.final_due_date) {
      facts.push({ label: "Final due date", value: agreement.final_due_date, kind: "date" });
    }
  }

  if (["settlement_confirmation", "ownership_transfer"].includes(documentType)) {
    const outstanding = numberValue(agreement.outstanding_balance);
    facts.push({
      label: "Recorded balance",
      amount: outstanding === null ? 0 : outstanding,
    });
  }

  if (documentType === "amendment_agreement" && context?.amendment?.amendment_number) {
    facts.push({
      label: "Amendment",
      value: context.amendment.amendment_number,
      kind: "text",
    });
  }

  return facts;
}

async function loadDocument(documentId, connection = pool) {
  const id = positiveId(documentId);
  if (!id) {
    throw new FinanceVerificationError(
      404,
      "The document verification reference is invalid.",
      "FINANCE_DOCUMENT_NOT_FOUND"
    );
  }

  const [rows] = await connection.query(
    `SELECT
       document.*,
       issuer.full_name AS issued_by_name,
       archiver.full_name AS archived_by_name
     FROM equipment_finance_issued_documents document
     LEFT JOIN users issuer ON issuer.id = document.issued_by
     LEFT JOIN users archiver ON archiver.id = document.archived_by
     WHERE document.id = ?
     LIMIT 1`,
    [id]
  );

  if (!rows.length) {
    throw new FinanceVerificationError(
      404,
      "No Chalin 03 Finance document matches this verification reference.",
      "FINANCE_DOCUMENT_NOT_FOUND"
    );
  }
  return rows[0];
}

async function verificationStatus(document, connection = pool) {
  if (!document.archived_at) {
    return { code: "verified", label: "Verified — Current issued record" };
  }

  const [newerRows] = await connection.query(
    `SELECT id, document_number, issued_at
     FROM equipment_finance_issued_documents
     WHERE agreement_id = ?
       AND document_type = ?
       AND archived_at IS NULL
       AND (issued_at > ? OR (issued_at = ? AND id > ?))
     ORDER BY issued_at DESC, id DESC
     LIMIT 1`,
    [
      document.agreement_id,
      document.document_type,
      document.issued_at,
      document.issued_at,
      document.id,
    ]
  );

  if (newerRows.length) {
    return {
      code: "superseded",
      label: "Superseded — A newer issued record exists",
      replacement_document_number: newerRows[0].document_number,
    };
  }

  return { code: "revoked", label: "Revoked / withdrawn record" };
}

async function verifyFinanceDocument({ documentId, token, connection = pool }) {
  const document = await loadDocument(documentId, connection);
  const expectedToken = verificationToken(document);
  if (
    !expectedToken ||
    !constantTimeEqual(expectedToken, cleanText(token, 128).toLowerCase())
  ) {
    throw new FinanceVerificationError(
      404,
      "This QR/reference does not match an issued Chalin 03 Finance document.",
      "FINANCE_DOCUMENT_TOKEN_INVALID"
    );
  }

  // snapshot_json is a MySQL JSON column. MySQL may normalize key ordering and
  // whitespace when it is read, so re-hashing its returned textual form can
  // falsely disagree with the byte string hashed at issuance. The QR token is
  // therefore bound to the immutable issuance checksum already stored beside
  // the snapshot rather than pretending a normalized JSON read is byte-identical.
  const snapshot = parseJson(document.snapshot_json, {});
  const agreement = snapshot.agreement || {};
  const status = await verificationStatus(document, connection);

  return {
    status,
    checksum_bound: true,
    document: {
      id: Number(document.id),
      document_number: document.document_number,
      document_type: document.document_type,
      document_title: documentTitle(document.document_type),
      document_format: document.document_format,
      template_version: document.template_version,
      issued_at: document.issued_at,
      issued_by_name:
        document.issued_by_name || "Chalin 03 authorised staff",
      checksum_fingerprint: cleanText(document.snapshot_checksum, 64)
        .slice(0, 12)
        .toUpperCase(),
    },
    agreement: {
      agreement_number: agreement.agreement_number || "Not published",
      customer_name: maskName(
        agreement.kyc_customer_name ||
          agreement.customer_name_snapshot ||
          agreement.customer_name
      ),
      customer_phone: maskPhone(
        agreement.customer_phone_snapshot || agreement.customer_phone
      ),
      machine_code:
        agreement.asset_code_snapshot || agreement.asset_code || "Not published",
      machine_name:
        agreement.asset_name_snapshot || agreement.asset_name || "Equipment",
      serial_number: maskSerial(
        agreement.serial_number_snapshot || agreement.serial_number
      ),
    },
    financial_facts: safeFinancialFacts(document.document_type, snapshot),
    privacy: {
      public_verification: true,
      sensitive_identity_hidden: true,
      source: "immutable_issued_document_snapshot",
      checksum_policy: "issuance_fingerprint_bound_to_qr_reference",
    },
  };
}

module.exports = {
  DOCUMENT_TITLES,
  FinanceVerificationError,
  TOKEN_NAMESPACE,
  validChecksum,
  verificationToken,
  verificationUrl,
  verifyFinanceDocument,
};
