const fs = require("node:fs");
const path = require("node:path");

const COLORS = Object.freeze({
  navy: "#0A1D2F",
  navySoft: "#EAF0F5",
  emerald: "#0A5038",
  emeraldDark: "#073B2A",
  emeraldSoft: "#EAF4EF",
  gold: "#D3A72C",
  goldDark: "#8D6811",
  goldSoft: "#FBF5DF",
  ink: "#17231D",
  muted: "#617067",
  line: "#D7E1DB",
  paper: "#FFFFFF",
  ash: "#F5F7F6",
  red: "#9C2E2E",
  redSoft: "#FBEDED",
  blue: "#245B8A",
  blueSoft: "#EAF2F9",
});

const DOCUMENT_TEMPLATES = Object.freeze({
  installment_agreement: {
    family: "legal",
    title: "INSTALLMENT SALE AGREEMENT",
    subtitle: "Master Contract",
    classification: "ORIGINAL",
    watermark: "INSTALLMENT AGREEMENT",
    accent: COLORS.emerald,
    accentSoft: COLORS.emeraldSoft,
  },
  customer_agreement_copy: {
    family: "legal",
    title: "INSTALLMENT SALE AGREEMENT",
    subtitle: "Customer Retention Copy",
    classification: "CUSTOMER COPY",
    watermark: "CUSTOMER COPY",
    accent: COLORS.blue,
    accentSoft: COLORS.blueSoft,
  },
  company_agreement_copy: {
    family: "legal",
    title: "INSTALLMENT SALE AGREEMENT",
    subtitle: "Controlled Company File",
    classification: "COMPANY COPY",
    watermark: "COMPANY COPY",
    accent: COLORS.navy,
    accentSoft: COLORS.navySoft,
  },
  boss_approval_pack: {
    family: "executive",
    title: "EXECUTIVE FINANCE APPROVAL PACK",
    subtitle: "Management Decision Dossier",
    classification: "STRICTLY INTERNAL",
    watermark: "APPROVAL PACK",
    accent: COLORS.navy,
    accentSoft: COLORS.navySoft,
  },
  payment_schedule: {
    family: "schedule",
    title: "OFFICIAL INSTALLMENT SCHEDULE",
    subtitle: "Exact Dated Payment Plan",
    classification: "FINANCE SCHEDULE",
    watermark: "PAYMENT SCHEDULE",
    accent: COLORS.blue,
    accentSoft: COLORS.blueSoft,
  },
  payment_receipt: {
    family: "receipt",
    title: "OFFICIAL PAYMENT RECEIPT",
    subtitle: "Committed Finance Payment",
    classification: "PAYMENT RECEIVED",
    watermark: "OFFICIAL RECEIPT",
    accent: COLORS.emerald,
    accentSoft: COLORS.emeraldSoft,
  },
  customer_statement: {
    family: "statement",
    title: "CUSTOMER INSTALLMENT STATEMENT",
    subtitle: "Reconciled Account Position",
    classification: "ACCOUNT STATEMENT",
    watermark: "CUSTOMER STATEMENT",
    accent: COLORS.navy,
    accentSoft: COLORS.navySoft,
  },
  machine_annexure: {
    family: "evidence",
    title: "MACHINE IDENTITY ANNEXURE",
    subtitle: "Protected Equipment Evidence",
    classification: "EVIDENCE ANNEXURE",
    watermark: "MACHINE ANNEXURE",
    accent: COLORS.goldDark,
    accentSoft: COLORS.goldSoft,
  },
  guarantor_undertaking: {
    family: "undertaking",
    title: "GUARANTOR UNDERTAKING",
    subtitle: "Supporting Legal Obligation",
    classification: "LEGAL UNDERTAKING",
    watermark: "GUARANTOR UNDERTAKING",
    accent: COLORS.navy,
    accentSoft: COLORS.navySoft,
  },
  delivery_handover_note: {
    family: "handover",
    title: "DELIVERY & HANDOVER NOTE",
    subtitle: "Controlled Physical Release Record",
    classification: "HANDOVER RECORD",
    watermark: "DELIVERY HANDOVER",
    accent: COLORS.goldDark,
    accentSoft: COLORS.goldSoft,
  },
  arrears_notice: {
    family: "notice",
    title: "FORMAL ARREARS NOTICE",
    subtitle: "Notice of Overdue Installments",
    classification: "ACTION REQUIRED",
    watermark: "ARREARS NOTICE",
    accent: COLORS.red,
    accentSoft: COLORS.redSoft,
  },
  amendment_agreement: {
    family: "amendment",
    title: "AGREEMENT AMENDMENT",
    subtitle: "Approved Change Control Record",
    classification: "AMENDMENT",
    watermark: "AMENDMENT",
    accent: COLORS.blue,
    accentSoft: COLORS.blueSoft,
  },
  settlement_confirmation: {
    family: "certificate",
    title: "FULL SETTLEMENT CERTIFICATE",
    subtitle: "Official Account Completion",
    classification: "FULLY SETTLED",
    watermark: "SETTLED",
    accent: COLORS.emerald,
    accentSoft: COLORS.emeraldSoft,
  },
  ownership_transfer: {
    family: "certificate",
    title: "OWNERSHIP TRANSFER CERTIFICATE",
    subtitle: "Controlled Transfer of Equipment Title",
    classification: "OWNERSHIP TRANSFER",
    watermark: "OWNERSHIP TRANSFER",
    accent: COLORS.navy,
    accentSoft: COLORS.navySoft,
  },
});

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

function clean(value, fallback = "Not recorded") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function label(value, fallback = "Not recorded") {
  return clean(value, fallback)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function money(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateLabel(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString("en-GH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "Africa/Accra",
  });
}

function dateTimeLabel(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-GH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Accra",
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function dataImage(value) {
  const match = String(value || "").match(
    /^data:image\/(?:jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/i
  );
  if (!match) return null;
  const buffer = Buffer.from(match[1], "base64");
  return buffer.length ? buffer : null;
}

function templateFor(document) {
  return (
    DOCUMENT_TEMPLATES[document?.document_type] || {
      family: "legal",
      title: label(document?.document_type, "Official Finance Document"),
      subtitle: "Official Chalin 03 Finance Record",
      classification: "OFFICIAL",
      watermark: label(document?.document_type, "OFFICIAL DOCUMENT"),
      accent: COLORS.emerald,
      accentSoft: COLORS.emeraldSoft,
    }
  );
}

function findOfficialLogoPath() {
  const candidates = [
    path.resolve(__dirname, "..", "assets", "chalin03-logo.png"),
    path.resolve(__dirname, "..", "..", "frontend", "public", "chalin03-logo.png"),
    path.resolve(process.cwd(), "..", "frontend", "public", "chalin03-logo.png"),
    path.resolve(process.cwd(), "frontend", "public", "chalin03-logo.png"),
    path.resolve(process.cwd(), "public", "chalin03-logo.png"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function officialLogoDataUrl() {
  const logoPath = findOfficialLogoPath();
  if (!logoPath) return "";
  try {
    return `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`;
  } catch {
    return "";
  }
}

function agreementOf(document) {
  return document?.snapshot?.agreement || {};
}

function customerName(document) {
  const agreement = agreementOf(document);
  return clean(
    agreement.kyc_customer_name ||
      agreement.customer_name_snapshot ||
      agreement.customer_name,
    "Customer"
  );
}

function machineName(document) {
  const agreement = agreementOf(document);
  return `${clean(agreement.asset_code, "")} — ${clean(agreement.asset_name, "")}`;
}

function verificationPayload(document) {
  const agreement = agreementOf(document);
  return [
    "CHALIN03-FINANCE-V2",
    `DOC:${clean(document?.document_number, "UNKNOWN")}`,
    `TYPE:${clean(document?.document_type, "unknown")}`,
    `AGR:${clean(agreement.agreement_number, "UNKNOWN")}`,
    `ISSUED:${clean(document?.issued_at || document?.snapshot?.generated_at, "UNKNOWN")}`,
    `SHA256:${clean(document?.snapshot_checksum, "UNKNOWN")}`,
  ].join("|");
}

module.exports = {
  COLORS,
  DOCUMENT_TEMPLATES,
  PHOTO_DOCUMENT_TYPES,
  agreementOf,
  clean,
  customerName,
  dataImage,
  dateLabel,
  dateTimeLabel,
  escapeHtml,
  findOfficialLogoPath,
  label,
  machineName,
  money,
  officialLogoDataUrl,
  templateFor,
  verificationPayload,
};
