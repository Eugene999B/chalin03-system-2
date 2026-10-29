"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const {
  SELLER_REPRESENTATIVE_NAME,
  nameForRole,
  signatureImageForRole,
} = require("../services/equipmentFinanceDocumentPartyNamesService");
const { renderCompletionWord } =
  require("../services/equipmentFinanceDocumentWordV2Service");

function snapshot(overrides = {}) {
  return {
    agreement: {
      kyc_customer_name: "Akosua Owusu",
      customer_name_snapshot: "Older Name",
      guarantor_name: "Kojo Mensah",
      total_amount: 120000,
      ...overrides,
    },
    company: {
      name: "Chalin 03 Company Limited",
      authorised_seller_name: "Finance Manager", // old configuration must not leak into printed names
    },
    signatures: [],
    schedule: [],
    payments: [],
    policy: { agreement_terms: "Original terms" },
    price_scenario: { original_price: 100000, proposed_price: 120000 },
  };
}

test("all unsigned finance documents print AGYAPONG CHARLES as representative and the recorded buyer", () => {
  const source = snapshot();
  assert.equal(SELLER_REPRESENTATIVE_NAME, "AGYAPONG CHARLES");
  assert.equal(nameForRole(source, "seller"), "AGYAPONG CHARLES");
  assert.equal(nameForRole(source, "buyer"), "Akosua Owusu");
  assert.equal(nameForRole(source, "guarantor"), "Kojo Mensah");
  assert.equal(nameForRole(source, "buyer_witness"), "");
  assert.equal(nameForRole(source, "seller", { signer_name: "Previous Manager" }), "AGYAPONG CHARLES");
});

test("buyer details use the existing contractual name without fabricating a missing one", () => {
  assert.equal(nameForRole(snapshot({ kyc_customer_name: "" }), "buyer"), "Older Name");
  assert.equal(nameForRole(snapshot({ kyc_customer_name: "", customer_name_snapshot: "", customer_name: "Third Name" }), "buyer"), "Third Name");
  assert.equal(nameForRole(snapshot({ kyc_customer_name: "", customer_name_snapshot: "", customer_name: "" }), "buyer"), "");
});

test("a stored person's signature is never falsely attributed to a different printed seller or buyer", () => {
  const source = snapshot();
  assert.equal(signatureImageForRole(source, "seller", { signer_name: "Another Worker", signature_data_url: "encodedSignature" }), null);
  assert.equal(signatureImageForRole(source, "buyer", { signer_name: "Wrong Buyer", signature_data_url: "encodedSignature" }), null);
  assert.equal(signatureImageForRole(source, "buyer", { signer_name: "Akosua Owusu", signature_data_url: "buyerImage" }), "buyerImage");
  assert.equal(signatureImageForRole(source, "seller", { signer_name: "AGYAPONG CHARLES", signature_data_url: "bossImage" }), "bossImage");
  assert.equal(signatureImageForRole(source, "seller"), null);
  assert.equal(signatureImageForRole({ ...source, company: { ...source.company, authorised_seller_name: "AGYAPONG CHARLES", authorised_seller_signature_data_url: "bossImage" } }, "seller"), "bossImage");
});

test("all Word signing-document types prefill the boss and buyer names in the existing branded design", async () => {
  for (const type of [
    "installment_agreement",
    "customer_agreement_copy",
    "company_agreement_copy",
    "guarantor_undertaking",
    "amendment_agreement",
    "delivery_handover_note",
    "settlement_confirmation",
    "ownership_transfer",
  ]) {
    const doc = {
      document_type: type,
      document_number: "PREFILL-001",
      snapshot: snapshot(),
      snapshot_checksum: "a".repeat(64),
    };
    const html = (await renderCompletionWord(doc)).toString("utf8");
    assert.match(html, /AGYAPONG CHARLES/, type);
    assert.match(html, /Akosua Owusu/, type);
    assert.match(html, /Execution and signatures/, type);
    assert.match(html, /Date \/ time/, type);
    assert.match(html, /signer-line/, type);
  }
});

test("every PDF finance signature renderer shares the same prefill rule", () => {
  const root = path.join(__dirname, "../services");
  for (const file of [
    "equipmentFinancePdfV2FlowWidgetService.js",
    "equipmentFinanceProfessionalService.js",
    "equipmentFinanceDocumentCompletionService.js",
    "equipmentFinanceCompletionRendererService.js",
    "equipmentFinancePremiumDocumentRendererService.js",
  ]) {
    const code = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(code, /equipmentFinanceDocumentPartyNamesService/, file);
    assert.match(code, /nameForRole\(/, file);
    assert.match(code, /signatureImageForRole\(/, file);
  }
});
