const fs = require("node:fs");
const path = require("node:path");
const {
  verificationUrl,
} = require("./equipmentFinanceVerificationService");

const COLORS = Object.freeze({
  forest: "#063D2C",
  forestDeep: "#032A20",
  forestSoft: "#E8F2ED",
  emerald: "#0B5A40",
  navy: "#0A1D2F",
  navySoft: "#EAF0F5",
  gold: "#D2A83A",
  goldBright: "#E8C567",
  goldDark: "#8C6816",
  champagne: "#F7E9BC",
  ivory: "#FCFAF4",
  paper: "#FFFFFF",
  ink: "#17231D",
  muted: "#67726C",
  line: "#D8DED9",
  ash: "#F3F6F4",
  red: "#9A3030",
  redSoft: "#FBECEC",
  blue: "#245B8A",
  blueSoft: "#EAF2F9",
});

function template({
  family,
  title,
  subtitle,
  classification,
  watermark,
  accent,
  accentSoft,
  motif,
}) {
  return Object.freeze({
    family,
    title,
    subtitle,
    classification,
    watermark,
    accent,
    accentSoft,
    motif,
    design_version: "logo-led-v3",
  });
}

const DOCUMENT_TEMPLATES = Object.freeze({
  installment_agreement: template({ family: "legal", title: "INSTALLMENT SALE AGREEMENT", subtitle: "Master Equipment Finance Contract", classification: "ORIGINAL", watermark: "INSTALLMENT AGREEMENT", accent: COLORS.forest, accentSoft: COLORS.forestSoft, motif: "contract" }),
  customer_agreement_copy: template({ family: "legal", title: "INSTALLMENT SALE AGREEMENT", subtitle: "Customer Retention Copy", classification: "CUSTOMER COPY", watermark: "CUSTOMER COPY", accent: COLORS.blue, accentSoft: COLORS.blueSoft, motif: "contract" }),
  company_agreement_copy: template({ family: "legal", title: "INSTALLMENT SALE AGREEMENT", subtitle: "Controlled Company File", classification: "COMPANY COPY", watermark: "COMPANY COPY", accent: COLORS.navy, accentSoft: COLORS.navySoft, motif: "contract" }),
  boss_approval_pack: template({ family: "executive", title: "EXECUTIVE FINANCE APPROVAL PACK", subtitle: "Management Decision Dossier", classification: "STRICTLY INTERNAL", watermark: "APPROVAL PACK", accent: COLORS.navy, accentSoft: COLORS.navySoft, motif: "executive" }),
  payment_schedule: template({ family: "schedule", title: "OFFICIAL INSTALLMENT SCHEDULE", subtitle: "Exact Dated Payment Plan", classification: "FINANCE SCHEDULE", watermark: "PAYMENT SCHEDULE", accent: COLORS.blue, accentSoft: COLORS.blueSoft, motif: "ledger" }),
  payment_receipt: template({ family: "receipt", title: "OFFICIAL PAYMENT RECEIPT", subtitle: "Committed Finance Payment", classification: "PAYMENT RECEIVED", watermark: "OFFICIAL RECEIPT", accent: COLORS.forest, accentSoft: COLORS.forestSoft, motif: "receipt" }),
  customer_statement: template({ family: "statement", title: "CUSTOMER INSTALLMENT STATEMENT", subtitle: "Reconciled Account Position", classification: "ACCOUNT STATEMENT", watermark: "CUSTOMER STATEMENT", accent: COLORS.navy, accentSoft: COLORS.navySoft, motif: "statement" }),
  machine_annexure: template({ family: "evidence", title: "MACHINE IDENTITY ANNEXURE", subtitle: "Protected Equipment Evidence", classification: "EVIDENCE ANNEXURE", watermark: "MACHINE ANNEXURE", accent: COLORS.goldDark, accentSoft: COLORS.champagne, motif: "evidence" }),
  guarantor_undertaking: template({ family: "undertaking", title: "GUARANTOR UNDERTAKING", subtitle: "Supporting Legal Obligation", classification: "LEGAL UNDERTAKING", watermark: "GUARANTOR UNDERTAKING", accent: COLORS.navy, accentSoft: COLORS.navySoft, motif: "undertaking" }),
  delivery_handover_note: template({ family: "handover", title: "DELIVERY & HANDOVER NOTE", subtitle: "Controlled Physical Release Record", classification: "HANDOVER RECORD", watermark: "DELIVERY HANDOVER", accent: COLORS.goldDark, accentSoft: COLORS.champagne, motif: "handover" }),
  arrears_notice: template({ family: "notice", title: "FORMAL ARREARS NOTICE", subtitle: "Notice of Overdue Installments", classification: "ACTION REQUIRED", watermark: "ARREARS NOTICE", accent: COLORS.red, accentSoft: COLORS.redSoft, motif: "notice" }),
  amendment_agreement: template({ family: "amendment", title: "AGREEMENT AMENDMENT", subtitle: "Approved Change Control Record", classification: "AMENDMENT", watermark: "AMENDMENT", accent: COLORS.blue, accentSoft: COLORS.blueSoft, motif: "amendment" }),
  settlement_confirmation: template({ family: "certificate", title: "FULL SETTLEMENT CERTIFICATE", subtitle: "Official Account Completion", classification: "FULLY SETTLED", watermark: "SETTLED", accent: COLORS.forest, accentSoft: COLORS.forestSoft, motif: "certificate" }),
  ownership_transfer: template({ family: "certificate", title: "OWNERSHIP TRANSFER CERTIFICATE", subtitle: "Controlled Transfer of Equipment Title", classification: "OWNERSHIP TRANSFER", watermark: "OWNERSHIP TRANSFER", accent: COLORS.navy, accentSoft: COLORS.navySoft, motif: "certificate" }),
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
  return `GHS ${Number(value || 0).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dateLabel(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString("en-GH", { year: "numeric", month: "short", day: "2-digit", timeZone: "Africa/Accra" });
}

function dateTimeLabel(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-GH", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Accra" });
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function dataImage(value) {
  const match = String(value || "").match(/^data:image\/(?:jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  const buffer = Buffer.from(match[1], "base64");
  return buffer.length ? buffer : null;
}

function templateFor(document) {
  return DOCUMENT_TEMPLATES[document?.document_type] || template({
    family: "legal",
    title: label(document?.document_type, "Official Finance Document"),
    subtitle: "Official Chalin 03 Finance Record",
    classification: "OFFICIAL",
    watermark: label(document?.document_type, "OFFICIAL DOCUMENT"),
    accent: COLORS.forest,
    accentSoft: COLORS.forestSoft,
    motif: "official",
  });
}

function findOfficialLogoPath() {
  const candidates = [
    path.resolve(__dirname, "..", "assets", "chalin03-logo.png"),
    path.resolve(__dirname, "..", "..", "frontend", "public", "chalin03-logo.png"),
    path.resolve(process.cwd(), "assets", "chalin03-logo.png"),
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
  return clean(agreement.kyc_customer_name || agreement.customer_name_snapshot || agreement.customer_name, "Customer");
}

function machineName(document) {
  const agreement = agreementOf(document);
  return `${clean(agreement.asset_code, "")} — ${clean(agreement.asset_name, "")}`;
}

function verificationPayload(document) {
  return verificationUrl(document) || "https://chalin03.com";
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
