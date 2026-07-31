const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const service = read(
  "backend",
  "services",
  "equipmentFinanceArrearsService.js"
);
const route = read(
  "backend",
  "routes",
  "equipmentInstallmentCommandRoutes.js"
);
const dispatcher = read(
  "frontend",
  "src",
  "pages",
  "EquipmentSalesWorkspacePage.jsx"
);
const layout = read(
  "frontend",
  "src",
  "layouts",
  "InstallmentFinanceLayout.jsx"
);
const page = read(
  "frontend",
  "src",
  "pages",
  "EquipmentFinanceArrearsPage.jsx"
);

const FINANCIAL_MUTATION =
  /(?:INSERT\s+INTO\s+(?:equipment_sale_payments|equipment_installment_schedule|equipment_sale_agreements)|UPDATE\s+(?:equipment_sale_payments|equipment_installment_schedule|equipment_sale_agreements)|DELETE\s+FROM\s+(?:equipment_sale_payments|equipment_installment_schedule|equipment_sale_agreements))/i;
const HIRE_MUTATION =
  /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:hire_contracts|hire_jobs|hire_dispatches|hire_invoices|hire_payments|hire_returns|hire_contract_assets)\b/i;
const DDL = /\b(?:CREATE|ALTER|DROP|TRUNCATE)\s+(?:TABLE|DATABASE)\b/i;

test("Finance arrears read model is company-wide and approved-credit only", () => {
  assert.match(service, /listInstallmentCollections/);
  assert.match(service, /agingBucket/);
  assert.match(service, /activation_source = 'approved_credit_application'/);
  assert.match(service, /scope: "company_wide"/);
  assert.match(service, /hire_location_selection_required: false/);
  assert.match(service, /hire_workflow_access: false/);
  assert.match(service, /automatic_sms_enabled: false/);
  assert.match(service, /financial_values_mutable: false/);
});

test("Finance arrears exposes due queues promises and follow-up actions", () => {
  for (const value of [
    "due_today",
    "overdue",
    "broken_promises",
    "follow_up_due",
    "never_contacted",
    "high_risk",
    "promise_date",
    "promise_amount",
    "next_action_date",
  ]) {
    assert.match(service, new RegExp(value));
  }
  assert.match(service, /statement\.pdf/);
  assert.match(service, /overdue\.pdf/);
  assert.match(service, /promise_status/);
  assert.match(service, /next_action_status/);
});

test("collection follow-ups and corrections are append-only audit evidence", () => {
  assert.match(service, /EQUIPMENT_FINANCE_COLLECTION_FOLLOW_UP_RECORDED/);
  assert.match(service, /EQUIPMENT_FINANCE_COLLECTION_FOLLOW_UP_CORRECTED/);
  assert.match(service, /writeAuditEvent/);
  assert.match(service, /original_activity_id/);
  assert.match(service, /original_record_preserved: true/);
  assert.match(service, /correction_method: "append_only_audit_evidence"/);
  assert.doesNotMatch(service, FINANCIAL_MUTATION);
  assert.doesNotMatch(service, HIRE_MUTATION);
  assert.doesNotMatch(service, DDL);
  assert.doesNotMatch(service, /sendSms|sendManualInstallmentReminder|WhatsApp/);
});

test("Finance arrears endpoints require protected Finance permissions", () => {
  assert.match(route, /"\/collections"/);
  assert.match(route, /"\/agreements\/:agreementId"/);
  assert.match(route, /"\/agreements\/:agreementId\/follow-ups"/);
  assert.match(
    route,
    /"\/agreements\/:agreementId\/follow-ups\/:followUpId\/corrections"/
  );
  assert.match(route, /requirePermission\("fleet\.assets\.view"\)/);
  assert.match(route, /requirePermission\("fleet\.assets\.manage"\)/);
  assert.match(route, /listFinanceArrears/);
  assert.match(route, /recordFinanceCollectionFollowUp/);
  assert.match(route, /correctFinanceCollectionFollowUp/);
});

test("Finance arrears interface is discoverable and remains separate from Hire", () => {
  assert.match(dispatcher, /EquipmentFinanceArrearsPage/);
  assert.match(dispatcher, /stage === "arrears"/);
  assert.match(layout, /Arrears & Collections Control/);
  assert.match(layout, /stage=arrears/);
  assert.match(page, /Due today/);
  assert.match(page, /Broken promises/);
  assert.match(page, /Download statement/);
  assert.match(page, /Download overdue notice/);
  assert.match(page, /Correct this evidence/);
  assert.match(page, /original evidence preserved/i);
  assert.doesNotMatch(page, /\/equipment-hire|\/hire-commercial/);
  assert.doesNotMatch(page, /sendSms|WhatsApp Reminder|automatic_sms_enabled/);
});
