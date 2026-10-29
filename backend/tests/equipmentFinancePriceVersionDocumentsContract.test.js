"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  PRICE_VERSION_TYPES,
  listPriceVersionDocuments,
  buildPriceVersionDocument,
} = require("../services/equipmentFinancePriceVersionDocumentsService");

const makeSource = () => ({
  company: {
    name: "Chalin 03 Company Limited",
    authorised_seller_signature_data_url: "data:image/png;base64,YWJj",
  },
  agreement: {
    id: 64,
    agreement_number: "EFA-0064",
    asset_code: "EXC-64",
    asset_name: "Excavator X",
    total_amount: 420000,
    financed_amount: 320000,
    deposit_required: 100000,
    deposit_received: 100000,
    amount_paid: 140000,
    outstanding_balance: 280000,
    periodic_amount: 160000,
    payment_frequency: "monthly",
    installment_count: 2,
    kyc_customer_name: "Buyer",
  },
  schedule: [
    { sequence_number: 1, due_date: "2026-12-10", scheduled_amount: 160000, amount_paid: 40000, balance: 120000 },
    { sequence_number: 2, due_date: "2027-01-10", scheduled_amount: 160000, amount_paid: 0, balance: 160000 },
  ],
  signatures: [{ signer_role: "seller", signature_data_url: "saved original" }],
  payments: [{ id: 52, receipt_number: "R-52", amount: 40000 }],
  media: [{ evidence_type: "front", file_url: "machine-photo" }],
  policy: { agreement_terms: "Original terms unchanged.", legal_review_status: "approved" },
  template_version: "v1",
  reconciliation: { consistent: true, mismatches: [] },
});

test("boss price library exposes the same eight finance document templates in PDF, Word and print", () => {
  assert.equal(PRICE_VERSION_TYPES.length, 8);
  const options = listPriceVersionDocuments();
  assert.equal(options.length, 8);
  assert.ok(options.find((d) => d.code === "company_agreement_copy"));
  assert.ok(options.find((d) => d.code === "customer_agreement_copy"));
  assert.ok(options.find((d) => d.code === "payment_schedule"));
  assert.ok(options.find((d) => d.code === "guarantor_undertaking"));
  for (const item of options) {
    assert.ok(item.title);
    assert.deepEqual(item.formats, ["pdf", "word", "print"]);
  }
});

test("eight alternate price templates preserve original signatures, ledger and terms", () => {
  const source = makeSource();
  for (const type of PRICE_VERSION_TYPES) {
    const output = buildPriceVersionDocument(source, 500000, type);
    assert.equal(output.document_type, type);
    assert.equal(output.snapshot.agreement.total_amount, 500000);
    assert.equal(output.snapshot.agreement.financed_amount, 400000);
    assert.equal(output.snapshot.agreement.periodic_amount, 200000);
    assert.equal(output.snapshot.schedule[0].scheduled_amount, 200000);
    assert.equal(output.snapshot.schedule[1].scheduled_amount, 200000);
    assert.equal(output.snapshot.schedule[0].due_date, source.schedule[0].due_date);
    assert.equal(output.snapshot.schedule[0].amount_paid, 40000);
    assert.equal(output.snapshot.agreement.amount_paid, 140000);
    assert.equal(output.snapshot.agreement.deposit_received, 100000);
    assert.equal(output.snapshot.agreement.deposit_required, 100000);
    assert.equal(output.snapshot.policy.agreement_terms, "Original terms unchanged.");
    assert.deepEqual(output.snapshot.signatures, []);
    assert.equal(output.snapshot.company.authorised_seller_signature_data_url, null);
    assert.match(output.document_number, /^EP-64-/);
    assert.equal(output.issued_at, null);
    assert.match(output.snapshot_checksum, /^[0-9a-f]{64}$/);
  }
  assert.equal(source.agreement.total_amount, 420000);
  assert.equal(source.agreement.periodic_amount, 160000);
  assert.equal(source.schedule[0].scheduled_amount, 160000);
  assert.equal(source.signatures.length, 1);
  assert.equal(source.payments.length, 1);
});

test("price version reference changes per price while keeping source agreement number", () => {
  const a = buildPriceVersionDocument(makeSource(), 470000, "installment_agreement");
  const b = buildPriceVersionDocument(makeSource(), 510000, "installment_agreement");
  assert.notEqual(a.document_number, b.document_number);
  assert.equal(a.snapshot.agreement.agreement_number, b.snapshot.agreement.agreement_number);
});

test("alternate-price workflow must not fabricate receipts, amendments, settlement, ownership or arrears", () => {
  for (const type of [
    "payment_receipt", "arrears_notice", "amendment_agreement",
    "settlement_confirmation", "ownership_transfer", "delivery_handover_note",
  ]) {
    assert.throws(() => buildPriceVersionDocument(makeSource(), 500000, type), /requires an original issued record/);
  }
});

test("professional renderer suppresses issued-document QR and shows signature requirement for price versions", () => {
  const base = path.resolve(__dirname, "..", "services");
  const pdf = fs.readFileSync(path.join(base, "equipmentFinanceDocumentRendererV2Service.js"), "utf8");
  const page = fs.readFileSync(path.join(base, "equipmentFinancePdfV2PageService.js"), "utf8");
  const word = fs.readFileSync(path.join(base, "equipmentFinanceDocumentWordV2Service.js"), "utf8");
  const routes = fs.readFileSync(path.join(__dirname, "..", "routes/equipmentFinancePriceScenarioRoutes.js"), "utf8");
  assert.match(pdf, /if \(!document\.snapshot\?\.price_scenario\) drawVerificationPanel/);
  assert.match(page, /PRICE VERSION • SIGNATURES REQUIRED/);
  assert.match(word, /document\.snapshot\?\.price_scenario \? ""/);
  assert.match(routes, /buildPriceVersionDocument/);
  assert.match(routes, /renderCompletionWord/);
  assert.match(routes, /renderCompletionPdf/);
  assert.match(routes, /\/professional\/price-documents\/options/);
  assert.doesNotMatch(routes, /\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM|equipment_)/i);
});
