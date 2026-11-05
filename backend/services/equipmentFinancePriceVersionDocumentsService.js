"use strict";

const crypto = require("crypto");
const {
  DOCUMENT_DEFINITIONS,
} = require("./equipmentFinanceDocumentCompletionService");
const { priceScenario } = require("./equipmentFinancePriceScenarioService");

/**
 * Only documents whose contents can be expressed from a source agreement and a
 * separately quoted selling price. Never reprice receipts, approved amendments,
 * arrears demands, settlement certificates or evidence of ownership transfer.
 * They belong to the unchanged ledger / legal issuance workflow.
 */
const PRICE_VERSION_TYPES = Object.freeze([
  "installment_agreement",
  "customer_agreement_copy",
  "company_agreement_copy",
  "boss_approval_pack",
  "payment_schedule",
  "machine_annexure",
  "guarantor_undertaking",
  "customer_statement",
]);

function listPriceVersionDocuments() {
  return PRICE_VERSION_TYPES.map((code) => ({
    code,
    title: DOCUMENT_DEFINITIONS[code].title,
    label: DOCUMENT_DEFINITIONS[code].short_title,
    formats: ["pdf", "word", "print"],
  }));
}

function buildPriceVersionDocument(sourceSnapshot, price, type = "installment_agreement") {
  if (!PRICE_VERSION_TYPES.includes(type)) {
    const error = new Error("This document requires an original issued record. Choose a price-document type.");
    error.statusCode = 400;
    error.code = "PRICE_VERSION_DOCUMENT_UNAVAILABLE";
    throw error;
  }
  const scenario = priceScenario(sourceSnapshot, price);
  const context = {
    ...scenario.document_context,
    document_type: type,
    document_title: DOCUMENT_DEFINITIONS[type].title,
    copy_label: DOCUMENT_DEFINITIONS[type].short_title,
    overdue: { rows: [], amount: 0, count: 0, oldest_due_date: null },
  };
  const snapshot = {
    ...scenario,
    document_context: context,
    // A price version has not been entered as a new financed contract. The
    // reconciliation belongs to the source record, not the adjusted figures.
    // Display this as a price document, not a reconciled posted balance.
    document_price_version: true,
  };
  // Every variant gets a distinct deterministic reference; the original
  // agreement number and source account continue to identify the machine.
  const cents = Math.round(Number(price) * 100);
  const digest = crypto.createHash("sha256")
    .update(JSON.stringify({
      agreement: String(scenario.agreement.id),
      type,
      price_cents: cents,
      dates: scenario.schedule.map((x) => [x.sequence_number, x.due_date, x.scheduled_amount]),
    }))
    .digest("hex");
  const checksum = crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  const ref = `EP-${scenario.agreement.id}-${type.replace(/_/g, "-").slice(0, 9).toUpperCase()}-${digest.slice(0, 8).toUpperCase()}`;

  return {
    document_number: ref,
    document_type: type,
    document_format: "pdf",
    snapshot,
    snapshot_checksum: checksum,
    issued_at: null,
  };
}

module.exports = {
  PRICE_VERSION_TYPES,
  listPriceVersionDocuments,
  buildPriceVersionDocument,
};
