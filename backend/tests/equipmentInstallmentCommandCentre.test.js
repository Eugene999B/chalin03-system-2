const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const {
  agingBucket,
  buildInstallmentReminderMessage,
  classifyScheduledReminder,
  defaultInstallmentReminderSettings,
  normalizeInstallmentReminderSettings,
  reminderLimitReason,
  riskProfile,
} = require("../services/equipmentInstallmentCommandService");

test("installment command settings start safe and enforce customer protection", () => {
  const defaults = defaultInstallmentReminderSettings();
  assert.equal(defaults.automatic_sms_enabled, false);
  assert.equal(defaults.manual_sms_enabled, true);
  assert.equal(defaults.manual_whatsapp_enabled, true);
  assert.equal(defaults.max_sms_7_days, 3);
  assert.equal(defaults.max_sms_30_days, 8);
  assert.equal(defaults.minimum_hours_between_sms, 24);
  assert.equal(defaults.timezone, "Africa/Accra");

  const normalized = normalizeInstallmentReminderSettings({
    automatic_sms_enabled: true,
    due_soon_days: [30, 7, 3, 3, 1, -1, 999],
    max_sms_7_days: 999,
    max_sms_30_days: 9999,
    minimum_hours_between_sms: 0,
    max_messages_per_run: 9999,
    reminder_time: "08:15",
    message_template:
      "Dear {customer_name}, GHS {outstanding_balance}. {due_sentence}",
  });
  assert.equal(normalized.automatic_sms_enabled, true);
  assert.deepEqual(normalized.due_soon_days, [30, 7, 3, 1]);
  assert.equal(normalized.max_sms_7_days, 50);
  assert.equal(normalized.max_sms_30_days, 200);
  assert.equal(normalized.minimum_hours_between_sms, 1);
  assert.equal(normalized.max_messages_per_run, 500);
  assert.equal(normalized.reminder_time, "08:15");

  assert.throws(
    () => normalizeInstallmentReminderSettings({ message_template: "Please pay" }),
    /must contain \{customer_name\} and \{outstanding_balance\}/
  );
});

test("portfolio risk and aging classify installment accounts", () => {
  const critical = riskProfile({
    agreement_status: "overdue",
    total_amount: 500000,
    outstanding_balance: 400000,
    overdue_amount: 300000,
    days_past_due: 100,
    amount_paid: 100000,
    customer_phone_snapshot: "0240000000",
    customer_id_number: "GHA-123",
    guarantor_name: "Reference Person",
    last_payment_at: "2026-05-01",
  }, "2026-07-28");
  assert.equal(critical.risk_band, "critical");
  assert.match(critical.recommended_action, /recovery review/i);
  assert.equal(agingBucket({ days_past_due: 0 }), "current");
  assert.equal(agingBucket({ days_past_due: 7 }), "1_7_days");
  assert.equal(agingBucket({ days_past_due: 30 }), "8_30_days");
  assert.equal(agingBucket({ days_past_due: 90 }), "61_90_days");
  assert.equal(agingBucket({ days_past_due: 91 }), "over_90_days");
});

test("automatic reminder classification is consolidated by agreement", () => {
  const settings = normalizeInstallmentReminderSettings({
    due_soon_days: [7, 3, 1],
    overdue_start_days: 1,
    overdue_repeat_days: 3,
  });
  assert.equal(
    classifyScheduledReminder(
      { oldest_overdue_date: null, next_schedule_due_date: "2026-08-04" },
      settings,
      "2026-08-01"
    ).type,
    "due_soon"
  );
  assert.equal(
    classifyScheduledReminder(
      { oldest_overdue_date: null, next_schedule_due_date: "2026-08-01" },
      settings,
      "2026-08-01"
    ).type,
    "due_today"
  );
  assert.equal(
    classifyScheduledReminder(
      { oldest_overdue_date: "2026-07-28", next_schedule_due_date: null },
      settings,
      "2026-08-01"
    ).type,
    "overdue"
  );
});

test("installment reminders use equipment and account values", () => {
  const message = buildInstallmentReminderMessage({
    account: {
      customer_name_snapshot: "Mr Mensah",
      agreement_number: "ESA-0001",
      asset_code_snapshot: "EX-001",
      asset_name_snapshot: "CAT 320 Excavator",
      outstanding_balance: 116000,
      overdue_amount: 26000,
      next_payment_amount: 26000,
      next_schedule_due_date: "2026-08-01",
    },
    location: {
      hire_location_name: "Dunkwa Equipment Yard",
      payment_phone: "0249469080",
    },
    settings: normalizeInstallmentReminderSettings({}),
    reminder: { type: "due_today", target_date: "2026-08-01", days: 0 },
  });
  assert.match(message, /Mr Mensah/);
  assert.match(message, /ESA-0001/);
  assert.match(message, /CAT 320 Excavator/);
  assert.match(message, /116,000\.00/);
  assert.match(message, /0249469080/);
  assert.ok(message.length <= 480);
});

test("weekly monthly and minimum-hour limits block excessive reminders", () => {
  const settings = normalizeInstallmentReminderSettings({
    max_sms_7_days: 3,
    max_sms_30_days: 8,
    minimum_hours_between_sms: 24,
  });
  assert.equal(
    reminderLimitReason({ count_7_days: 3, count_30_days: 3 }, settings),
    "maximum_7_day_limit"
  );
  assert.equal(
    reminderLimitReason({ count_7_days: 1, count_30_days: 8 }, settings),
    "maximum_30_day_limit"
  );
  assert.equal(
    reminderLimitReason(
      {
        count_7_days: 1,
        count_30_days: 1,
        last_sent_at: "2026-08-01T02:00:00Z",
      },
      settings,
      new Date("2026-08-01T12:00:00Z")
    ),
    "minimum_hours_not_reached"
  );
});

test("command routes expose portfolio collections settings follow-up and reminders", () => {
  const route = read("backend/routes/equipmentInstallmentCommandRoutes.js");
  for (const pattern of [
    /"\/portfolio"/,
    /"\/collections"/,
    /"\/agreements\/:agreementId"/,
    /"\/agreements\/:agreementId\/follow-ups"/,
    /"\/settings"/,
    /"\/reminders\/preview"/,
    /"\/reminders\/run"/,
    /"\/reminders\/history"/,
    /"\/agreements\/:agreementId\/reminder-message"/,
    /"\/agreements\/:agreementId\/sms"/,
  ]) {
    assert.match(route, pattern);
  }
  assert.match(route, /RUN INSTALLMENT REMINDERS/);
  assert.match(route, /requirePermission\("fleet\.assets\.manage"\)/);
  assert.match(route, /automatic_whatsapp_available: false/);
});

test("command service is read-heavy and uses existing protected evidence tables", () => {
  const service = read("backend/services/equipmentInstallmentCommandService.js");
  const wrapper = read("backend/services/equipmentSalesReminderService.js");
  assert.match(service, /group_configuration/);
  assert.match(service, /group_configuration_history/);
  assert.match(service, /activity_log/);
  assert.match(service, /equipment_sales_reminder_log/);
  assert.match(service, /sms_log/);
  assert.match(service, /GET_LOCK/);
  assert.match(service, /EQUIPMENT_INSTALLMENT_FOLLOW_UP_RECORDED/);
  assert.match(service, /portfolio_at_risk_rate/);
  assert.match(service, /promise_date/);
  assert.match(service, /max_messages_per_run/);
  assert.match(service, /startEquipmentSalesReminderScheduler/);
  assert.doesNotMatch(service, /CREATE TABLE|ALTER TABLE|DROP TABLE|TRUNCATE TABLE/i);
  assert.match(wrapper, /equipmentSalesRoutes\.use\("\/installment-command"/);
});
