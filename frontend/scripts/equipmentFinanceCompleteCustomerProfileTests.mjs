import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const page = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "src",
    "pages",
    "EquipmentFinanceStartWizardEnhancedPage.jsx"
  ),
  "utf8"
);
const config = fs.readFileSync(
  path.join(__dirname, "..", "vite.config.js"),
  "utf8"
);

testProfileIsLoadedInTheOperationalWizard();
testFullCustomerAndKycFieldsRemainVisible();
testDraftCreationStaysLightweight();
testSensitiveDocumentsUsePrivateVault();
testDraftAutosaveCompatibility();

function testProfileIsLoadedInTheOperationalWizard() {
  assert.match(config, /restore-complete-finance-customer-profile/);
  assert.match(config, /EquipmentFinanceOperationalStartPage\.jsx/);
  assert.match(config, /EquipmentFinanceStartWizardEnhancedPage\.jsx/);
  assert.match(page, /<EquipmentFinanceStartWizardPage key=\{wizardVersion\}/);
}

function testFullCustomerAndKycFieldsRemainVisible() {
  for (const requiredText of [
    "Full legal name / registered business name",
    "Contact person / authorised representative",
    "GhanaPost GPS / digital address",
    "Employment or business profile",
    "Emergency or next-of-kin contact",
    "Monthly affordability",
    "Guarantor details",
    "Consent and internal KYC notes",
    "Business registration number",
    "Years at current residence",
    "Work / business address",
  ]) {
    assert.match(page, new RegExp(requiredText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const payloadKey of [
    "id_number",
    "date_of_birth",
    "nationality",
    "employment_type",
    "occupation",
    "employer_business_name",
    "business_registration_number",
    "residential_address",
    "work_address",
    "years_at_residence",
    "years_in_employment_business",
    "emergency_contact_name",
    "emergency_contact_phone",
    "emergency_contact_relationship",
    "guarantor_name",
    "guarantor_phone",
    "guarantor_address",
    "guarantor_id_type",
    "guarantor_id_number",
    "guarantor_relationship",
    "customer_consent_confirmed",
    "credit_assessment_consent_confirmed",
    "verification_notes",
  ]) {
    assert.match(page, new RegExp(payloadKey));
  }
}

function testDraftCreationStaysLightweight() {
  assert.match(page, /Only the customer legal name and primary phone/);
  assert.match(page, /missing optional information does not stop draft\s+creation/);
  assert.doesNotMatch(page, /required\s+value=\{profile\.kyc/);
  assert.match(page, /Required to create a new-customer draft/);
}

function testSensitiveDocumentsUsePrivateVault() {
  assert.match(page, /private case-document vault/);
  assert.match(page, /not in a\s+public file link/);
  assert.doesNotMatch(page, /Identity document URL/);
  assert.doesNotMatch(page, /Bank statement URL/);
}

function testDraftAutosaveCompatibility() {
  assert.match(page, /chalin03\.finance\.start-installment\.v2/);
  assert.match(page, /chalin03\.finance\.start-installment\.v1/);
  assert.match(page, /window\.setInterval\(synchronize, 700\)/);
  assert.match(page, /customerMode: existing\.customerMode \|\| "new"/);
  assert.match(page, /GhanaPost GPS:/);
}

console.log("Equipment Finance complete customer profile contracts passed.");
