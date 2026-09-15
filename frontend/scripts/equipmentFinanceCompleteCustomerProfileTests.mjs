import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const readPage = (name) =>
  fs.readFileSync(path.join(__dirname, "..", "src", "pages", name), "utf8");

const enhancedPage = readPage("EquipmentFinanceStartWizardEnhancedPage.jsx");
const wizardPage = readPage("EquipmentFinanceStartWizardPage.jsx");
const optionalStartPage = readPage("EquipmentFinanceStartWizardOptionalPage.jsx");
const operationalStartPage = readPage("EquipmentFinanceOperationalStartImmediatePage.jsx");
const applicationsPage = readPage("EquipmentFinanceApplicationsPage.jsx");
const optionalApplicationsPage = readPage("EquipmentFinanceApplicationsOptionalPage.jsx");
const config = fs.readFileSync(path.join(__dirname, "..", "vite.config.js"), "utf8");

testProfileIsLoadedInTheOperationalWizard();
testFullCustomerAndKycFieldsRemainVisible();
testOptionalDetailsNeverBlockDraftCreation();
testSensitiveDocumentsUsePrivateVault();
testDraftAutosaveCompatibility();

function testProfileIsLoadedInTheOperationalWizard() {
  assert.match(config, /restore-complete-finance-customer-profile/);
  assert.match(config, /EquipmentFinanceOperationalStartPage\.jsx/);
  assert.match(config, /EquipmentFinanceStartWizardOptionalPage\.jsx/);
  assert.match(config, /EquipmentSalesWorkspacePage\.jsx/);
  assert.match(config, /EquipmentFinanceApplicationsOptionalPage\.jsx/);

  // Production-standard Start New Installment now has one dedicated hierarchy.
  // The old enhanced wrapper remains only as compatibility source and is no longer
  // stacked around the operational transaction studio.
  assert.match(optionalStartPage, /EquipmentFinanceStartWizardPage/);
  assert.match(optionalStartPage, /legacy optional/);
  assert.match(optionalStartPage, /one real[\s\S]*page hierarchy/);
  assert.match(operationalStartPage, /EquipmentFinanceStartWizardPage/);
  assert.match(operationalStartPage, /Server recovery never blocks this screen/);
}

function testFullCustomerAndKycFieldsRemainVisible() {
  for (const requiredText of [
    "Legal / registered name",
    "Authorised representative",
    "Employment / business type",
    "Business registration number",
    "Residential address",
    "Work / business address",
    "Monthly salary income",
    "Emergency contact name",
    "Guarantor name",
    "Customer information consent confirmed",
    "Credit assessment consent confirmed",
  ]) {
    assert.match(
      wizardPage,
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
  ]) {
    assert.match(wizardPage, new RegExp(payloadKey));
  }
}

function testOptionalDetailsNeverBlockDraftCreation() {
  assert.match(wizardPage, /Step 4 · Optional assessment/);
  assert.match(
    wizardPage,
    /These fields can be completed now or later\. They do not prevent draft creation unless a commercial rule explicitly requires them\./
  );
  assert.match(wizardPage, /optionalMissing/);
  assert.match(
    wizardPage,
    /Optional assessment gaps will remain visible on the application for later completion\./
  );

  // Creation validation is deliberately limited to customer, machine and terms.
  assert.match(wizardPage, /for \(const index of \[0, 1, 2\]\)/);
  assert.doesNotMatch(wizardPage, /validate\(3\)/);

  // The compatibility applications wrapper keeps the established optional-data
  // approval rule while the dedicated wizard owns the actual creation experience.
  assert.match(optionalApplicationsPage, /Optional-information rule/);
  assert.match(
    optionalApplicationsPage,
    /do not stop submission or\s+approval by an authorised manager/
  );
  assert.match(optionalApplicationsPage, /This does not block submission or approval/);
}

function testSensitiveDocumentsUsePrivateVault() {
  // The retired enhanced profile source is still retained for backwards-compatible
  // drafts, so its document guidance must continue to forbid public identity links.
  assert.match(enhancedPage, /private case-document vault/);
  assert.match(enhancedPage, /not in a\s+public file link/);
  assert.doesNotMatch(enhancedPage, /Identity document URL/);
  assert.doesNotMatch(enhancedPage, /Bank statement URL/);
}

function testDraftAutosaveCompatibility() {
  assert.match(wizardPage, /chalin03\.finance\.start-installment\.v2/);
  assert.match(wizardPage, /chalin03:finance-draft-change/);
  assert.doesNotMatch(wizardPage, /window\.setInterval/);

  // Operational recovery remains the bridge for v1 drafts and server autosave.
  assert.match(operationalStartPage, /chalin03\.finance\.start-installment\.v2/);
  assert.match(operationalStartPage, /chalin03\.finance\.start-installment\.v1/);
  assert.match(operationalStartPage, /chalin03:finance-draft-change/);
  assert.match(operationalStartPage, /RECOVERY_TIMEOUT_MS = 8000/);
  assert.match(operationalStartPage, /SAVE_TIMEOUT_MS = 12000/);
  assert.doesNotMatch(operationalStartPage, /Preparing secure draft recovery/);
  assert.doesNotMatch(operationalStartPage, /window\.setInterval/);

  // Application edits still use the production 900 ms debounce; the old helper
  // sentence was removed from the UI, so assert the behavior instead of stale copy.
  assert.match(
    applicationsPage,
    /window\.setTimeout\(\(\) => saveEdit\(\{ manual: false \}\), 900\)/
  );
  assert.match(applicationsPage, /known_version/);

  // Preserve the compatibility source's v1/v2 migration contract even though it
  // no longer wraps the live Start New Installment route.
  assert.match(enhancedPage, /chalin03\.finance\.start-installment\.v2/);
  assert.match(enhancedPage, /chalin03\.finance\.start-installment\.v1/);
  assert.doesNotMatch(enhancedPage, /window\.setInterval\(synchronize, 700\)/);
}

console.log("Equipment Finance complete customer profile contracts passed.");
