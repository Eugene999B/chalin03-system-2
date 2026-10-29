"use strict";

/**
 * One consistent signing-party display rule for all Chalin03 equipment finance
 * documents. These are printed names, not digital signatures or an indication
 * that someone has signed or approved a document.
 */
const SELLER_REPRESENTATIVE_NAME = "AGYAPONG CHARLES";

function text(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function nameForRole(snapshot, role, signedRecord = null) {
  const agreement = snapshot?.agreement || {};
  if (role === "seller") return SELLER_REPRESENTATIVE_NAME;
  if (role === "buyer") {
    return text(
      agreement.kyc_customer_name ||
      agreement.customer_name_snapshot ||
      agreement.customer_name ||
      agreement.buyer_name ||
      ""
    );
  }
  if (role === "guarantor") {
    return text(
      agreement.kyc_guarantor_name ||
      agreement.guarantor_name ||
      signedRecord?.signer_name ||
      ""
    );
  }
  return text(signedRecord?.signer_name || "");
}

/** Preserve genuine signing evidence; do not attribute somebody else's
 * recorded signature to the prefilled seller or buyer printed name. */
function signatureMatchesPrintedName(snapshot, role, signedRecord) {
  if (!signedRecord?.signature_data_url || !["seller", "buyer"].includes(role)) return true;
  const recorded = text(signedRecord.signer_name).toLocaleLowerCase("en");
  const shown = nameForRole(snapshot, role).toLocaleLowerCase("en");
  return Boolean(recorded && shown && recorded === shown);
}

function signatureImageForRole(snapshot, role, signedRecord = null) {
  if (!signatureMatchesPrintedName(snapshot, role, signedRecord)) return null;
  if (signedRecord?.signature_data_url) return signedRecord.signature_data_url;
  if (role !== "seller") return null;
  // An organisation-wide stored signature is only attributable to the boss if
  // its configured signer name matches the boss's identity.
  return text(snapshot?.company?.authorised_seller_name).toLocaleLowerCase("en") ===
    SELLER_REPRESENTATIVE_NAME.toLocaleLowerCase("en")
    ? snapshot?.company?.authorised_seller_signature_data_url || null
    : null;
}

module.exports = {
  SELLER_REPRESENTATIVE_NAME,
  nameForRole,
  signatureMatchesPrintedName,
  signatureImageForRole,
};
