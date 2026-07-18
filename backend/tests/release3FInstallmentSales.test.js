const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const {
  buildInstallmentSchedule,
  validateInstallmentPlan,
} = require("../services/installmentService");

test("Release 3F-B builds exact weekly, fortnightly and monthly schedules", () => {
  const weekly = buildInstallmentSchedule({
    financedAmount: 100,
    installmentCount: 3,
    firstDueDate: "2026-08-01",
    frequency: "weekly",
  });

  assert.deepEqual(
    weekly.map((row) => row.due_date),
    ["2026-08-01", "2026-08-08", "2026-08-15"]
  );
  assert.equal(
    weekly.reduce((sum, row) => sum + row.scheduled_amount, 0),
    100
  );

  const fortnightly = buildInstallmentSchedule({
    financedAmount: 90,
    installmentCount: 2,
    firstDueDate: "2026-08-01",
    frequency: "fortnightly",
  });
  assert.deepEqual(
    fortnightly.map((row) => row.due_date),
    ["2026-08-01", "2026-08-15"]
  );

  const monthly = buildInstallmentSchedule({
    financedAmount: 120,
    installmentCount: 3,
    firstDueDate: "2026-01-31",
    frequency: "monthly",
  });
  assert.deepEqual(
    monthly.map((row) => row.due_date),
    ["2026-01-31", "2026-02-28", "2026-03-31"]
  );
});

test("Release 3F-B validates Ghana phone, outstanding balance and accepted terms", () => {
  const plan = validateInstallmentPlan(
    {
      frequency: "monthly",
      installment_count: 3,
      first_due_date: "2026-08-01",
      customer_phone: "0241234567",
      terms_accepted: true,
      delivery_policy: "after_full_payment",
    },
    { total: 900, deposit: 300 }
  );

  assert.equal(plan.customer_phone_normalized, "+233241234567");
  assert.equal(plan.financed_amount, 600);
  assert.equal(plan.schedule.length, 3);
  assert.equal(plan.delivery_policy, "after_full_payment");

  assert.throws(
    () =>
      validateInstallmentPlan(
        {
          frequency: "monthly",
          installment_count: 3,
          first_due_date: "2026-08-01",
          customer_phone: "0241234567",
          terms_accepted: false,
        },
        { total: 900, deposit: 300 }
      ),
    /accept the installment terms/i
  );

  assert.throws(
    () =>
      validateInstallmentPlan(
        {
          frequency: "monthly",
          installment_count: 3,
          first_due_date: "2026-08-01",
          customer_phone: "0241234567",
          terms_accepted: true,
        },
        { total: 900, deposit: 900 }
      ),
    /outstanding balance/i
  );
});

test("Release 3F-B migration is additive and complete", () => {
  const migration = read(
    "database/migrations/20260718_release3fb_professional_installment_sales.sql"
  );
  const verification = read(
    "database/migrations/20260718_release3fb_professional_installment_sales_verify.sql"
  );

  for (const table of [
    "installment_settings",
    "installment_sequences",
    "installment_agreements",
    "installment_agreement_items",
    "installment_schedule",
    "installment_payments",
    "installment_payment_allocations",
    "installment_reschedules",
    "installment_reminder_log",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }

  assert.match(migration, /'installment'\s*\)/);
  assert.match(migration, /uq_installment_agreement_sale/);
  assert.match(migration, /uq_installment_reminder_key/);
  assert.match(verification, /agreement_financial_integrity/);
  assert.match(verification, /cross_branch_isolation/);

  assert.doesNotMatch(migration, /\bDROP\s+(TABLE|DATABASE)\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(migration, /^\s*USE\s+/im);
});

test("Release 3F-B sale creation integrates professional installment plans", () => {
  const saleRoutes = read("backend/routes/saleRoutes.js");

  assert.match(saleRoutes, /payment_type.*installment/s);
  assert.match(saleRoutes, /installment_plan/);
  assert.match(saleRoutes, /createAgreementForSale/);
  assert.match(saleRoutes, /sendInstallmentEventSms/);
  assert.match(saleRoutes, /installment_agreement_number/);
  assert.match(saleRoutes, /Installment sales require both the customer name/);
});

test("Release 3F-B routes enforce store isolation and explicit permissions", () => {
  const routes = read("backend/routes/installmentRoutes.js");

  assert.match(routes, /STORE_CONTEXT_REQUIRED/);
  assert.match(routes, /ia\.branch_id = \?/);
  assert.match(routes, /requirePermission\("installments\.collect"\)/);
  assert.match(routes, /requirePermission\("installments\.manage"\)/);
  assert.match(routes, /requirePermission\("installments\.remind"\)/);
  assert.match(routes, /requirePermission\("installments\.export"\)/);
  assert.match(routes, /requirePermission\("installments\.settings"\)/);
  assert.match(routes, /INSTALLMENT_PAYMENT_VOIDED/);
  assert.match(routes, /INSTALLMENT_LATE_CHARGE_WAIVED/);
  assert.match(routes, /INSTALLMENT_AGREEMENT_APPROVED/);
});

test("Release 3F-B provides payment, rescheduling, delivery, SMS and exports", () => {
  const routes = read("backend/routes/installmentRoutes.js");
  const reminder = read("backend/services/installmentReminderService.js");

  assert.match(routes, /\/payments"/);
  assert.match(routes, /\/reschedule"/);
  assert.match(routes, /\/deliver"/);
  assert.match(routes, /\/cancel"/);
  assert.match(routes, /agreement\.pdf/);
  assert.match(routes, /receipt\.pdf/);
  assert.match(routes, /statement\.csv/);
  assert.match(routes, /workbook\.xlsx/);
  assert.match(reminder, /INSTALLMENT_SMS_REMINDERS_ENABLED/);
  assert.match(reminder, /already_processed/);
  assert.match(reminder, /payment_receipt/);
  assert.match(reminder, /completed/);
  assert.match(reminder, /result\?\.status \|\| "failed"/);
  assert.doesNotMatch(reminder, /status\s*=\s*"delivered"/);
});

test("Release 3F-B is registered in navigation, permissions and UI", () => {
  const server = read("backend/server.js");
  const app = read("frontend/src/App.jsx");
  const layout = read("frontend/src/components/Layout.jsx");
  const permissions = read("backend/security/permissionCatalog.js");
  const frontendPermissions = read("frontend/src/security/permissionRules.js");
  const newSale = read("frontend/src/pages/NewSalePage.jsx");
  const page = read("frontend/src/pages/InstallmentsPage.jsx");

  assert.match(server, /installmentRoutes/);
  assert.match(server, /\/api\/installments/);
  assert.match(server, /startInstallmentReminderScheduler/);
  assert.match(app, /InstallmentsPage/);
  assert.match(app, /path="installments"/);
  assert.match(layout, /Installment Sales/);

  for (const permission of [
    "installments.view",
    "installments.manage",
    "installments.collect",
    "installments.remind",
    "installments.export",
    "installments.settings",
  ]) {
    assert.match(permissions, new RegExp(permission.replaceAll(".", "\\.")));
  }

  assert.match(frontendPermissions, /INSTALLMENT_PERMISSIONS/);
  assert.match(newSale, /Installment Agreement/);
  assert.match(newSale, /terms_accepted/);
  assert.match(newSale, /after_full_payment/);
  assert.match(page, /Professional Installment Sales/);
  assert.match(page, /Record Payment/);
  assert.match(page, /Run Due Reminders/);
  assert.match(page, /Agreement PDF/);
});

test("Release 3F-B integrates backups and Daily Closing collections", () => {
  const backup = read("backend/routes/backupRoutes.js");
  const professional = read("backend/routes/release2FinalRoutes.js");
  const closing = read("backend/routes/dailyClosingRoutes.js");

  for (const table of [
    "installment_settings",
    "installment_agreements",
    "installment_schedule",
    "installment_payments",
    "installment_reminder_log",
  ]) {
    assert.match(backup, new RegExp(`"${table}"`));
    assert.match(professional, new RegExp(`"${table}"`));
  }

  assert.match(closing, /Installment Sales/);
  assert.match(closing, /FROM installment_payments ip/);
  assert.match(closing, /'installment' AS collection_type/);
});

test("Release 3F-B preserves approval, cancellation and default controls", () => {
  const service = read("backend/services/installmentService.js");
  const routes = read("backend/routes/installmentRoutes.js");

  assert.match(service, /requires manager approval before any installment deposit/i);
  assert.match(service, /agreement\.approval_status === "pending"/);
  assert.match(service, /\["cancelled", "waived"\]\.includes\(row\.schedule_status\)/);
  assert.match(routes, /cancelUnderlyingSaleAndDebt/);
  assert.match(routes, /Only undelivered reserved agreements can be cancelled/i);
  assert.match(routes, /\/default-status"/);
  assert.match(routes, /INSTALLMENT_MARKED_DEFAULTED/);
  assert.match(routes, /INSTALLMENT_REACTIVATED/);
});

test("Release 3F-B payment receipts are concurrency-safe and channel-specific", () => {
  const routes = read("backend/routes/installmentRoutes.js");
  const migration = read(
    "database/migrations/20260718_release3fb_professional_installment_sales.sql"
  );

  assert.match(routes, /crypto\.randomUUID\(\)/);
  assert.match(routes, /paymentReceiptNumber/);
  assert.match(routes, /String\(paymentId\)\.padStart/);
  assert.doesNotMatch(
    migration,
    /installment_payments[\s\S]{0,800}payment_method ENUM\([^)]*'mixed'/
  );
});

test("Release 3F-B reminder timing honors configured before and overdue days", () => {
  const reminder = read("backend/services/installmentReminderService.js");
  const page = read("frontend/src/pages/InstallmentsPage.jsx");

  assert.match(reminder, /shouldSendScheduledReminder/);
  assert.match(reminder, /overdueReminderDays/);
  assert.match(reminder, /daysUntilDue ===/);
  assert.match(reminder, /SELECT id FROM branches ORDER BY id LIMIT 100/);
  assert.match(page, /Overdue reminder days/);
  assert.match(page, /require_manager_approval/);
  assert.match(page, /sms_reminders_enabled/);
});

test("Release 3F-B custom plans are available during sale and rescheduling", () => {
  const newSale = read("frontend/src/pages/NewSalePage.jsx");
  const page = read("frontend/src/pages/InstallmentsPage.jsx");

  assert.match(newSale, /Custom Due Dates/);
  assert.match(newSale, /custom_due_dates_text/);
  assert.match(newSale, /custom_due_dates:/);
  assert.match(page, /custom_due_dates: customDueDates/);
  assert.match(page, /weekly, fortnightly, monthly or custom/);
});
