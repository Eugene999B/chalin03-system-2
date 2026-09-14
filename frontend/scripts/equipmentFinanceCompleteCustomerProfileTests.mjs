import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const enhancedPage = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "src",
    "pages",
    "EquipmentFinanceStartWizardEnhancedPage.jsx"
  ),
  "utf8"
);
const optionalStartPage = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "src",
    "pages",
    "EquipmentFinanceStartWizardOptionalPage.jsx"
  ),
  "utf8"
);
const operationalStartPage = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "src",
    "pages",
    "EquipmentFinanceOperationalStartImmediatePage.jsx"
  ),
  "utf8"
);
const applicationsPage = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "src",
    "pages",
    "EquipmentFinanceApplicationsPage.jsx"
  ),
  "utf8"
);
const optionalApplicationsPage = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "src",
    "pages",
    "EquipmentFinanceApplicationsOptionalPage.jsx"
  ),
  "utf8"
);
const config = fs.readFileSync(
  path.join(__dirname, "..", "vite.config.js"),
  "utf8"
);

testProfileIsLoadedInTheOperationalWizard();
testFullCustomerAndKycFieldsRemainVisible();
testOptionalDetailsNeverBlockWorkflow();
testSensitiveDocumentsUsePrivateVault();
testDraftAutosaveCompatibility();

function testProfileIsLoadedInTheOperationalWizard() {
  assert.match(config, /restore-complete-finance-customer-profile/);
  assert.match(config, /EquipmentFinanceOperationalStartPage\.jsx/);
  assert.match(config, /EquipmentFinanceStartWizardOptionalPage\.jsx/);
  assert.match(config, /EquipmentSalesWorkspacePage\.jsx/);
  assert.match(config, /EquipmentFinanceApplicationsOptionalPage\.jsx/);
  assert.match(optionalStartPage, /EquipmentFinanceStartWizardEnhancedPage/);
  assert.match(operationalStartPage, /EquipmentFinanceStartWizardPage/);
  assert.match(operationalStartPage, /Server recovery never blocks this screen/);
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
    assert.match(
      enhancedPage,
      new RegExp(requiredText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
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
    assert.match(enhancedPage, new RegExp(payloadKey));
  }
}

function testOptionalDetailsNeverBlockWorkflow() {
  assert.match(
    optionalStartPage,
    /Leaving any other field blank does not block draft creation, submission, review or approval/
  );
  assert.match(
    optionalStartPage,
    /Missing KYC, affordability, guarantor, consent or supporting-document details never prevent submission or approval/
  );
  assert.match(optionalStartPage, /optional sections recorded/);
  assert.doesNotMatch(optionalStartPage, /must be completed and independently verified/);

  assert.match(optionalApplicationsPage, /Optional-information rule/);
  assert.match(
    optionalApplicationsPage,
    /do not stop submission or\s+approval by an authorised manager/
  );
  assert.match(
    optionalApplicationsPage,
    /This does not block submission or approval/
  );

  assert.doesNotMatch(enhancedPage, /required\s+value=\{profile\.kyc/);
  assert.match(enhancedPage, /Required to create a new-customer draft/);
}

function testSensitiveDocumentsUsePrivateVault() {
  assert.match(enhancedPage, /private case-document vault/);
  assert.match(enhancedPage, /not in a\s+public file link/);
  assert.match(optionalStartPage, /private vault when available/);
  assert.doesNotMatch(enhancedPage, /Identity document URL/);
  assert.doesNotMatch(enhancedPage, /Bank statement URL/);
}

function testDraftAutosaveCompatibility() {
  assert.match(enhancedPage, /chalin03\.finance\.start-installment\.v2/);
  assert.match(enhancedPage, /chalin03\.finance\.start-installment\.v1/);
  assert.doesNotMatch(enhancedPage, /window\.setInterval\(synchronize, 700\)/);
  assert.match(operationalStartPage, /chalin03\.finance\.start-installment\.v2/);
  assert.match(operationalStartPage, /chalin03:finance-draft-change/);
  assert.match(operationalStartPage, /RECOVERY_TIMEOUT_MS = 8000/);
  assert.match(operationalStartPage, /SAVE_TIMEOUT_MS = 12000/);
  assert.doesNotMatch(operationalStartPage, /Preparing secure draft recovery/);
  assert.doesNotMatch(operationalStartPage, /window\.setInterval/);
  assert.match(applicationsPage, /Changes autosave after 900 ms/);
  assert.match(applicationsPage, /known_version/);
  assert.match(enhancedPage, /customerMode: existing\.customerMode \|\| "new"/);
  assert.match(enhancedPage, /GhanaPost GPS:/);
}

console.log("Equipment Finance complete optional customer profile contracts passed.");
