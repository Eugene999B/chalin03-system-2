const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");

function read(...parts) {
  return fs.readFileSync(path.join(root, ...parts), "utf8");
}

function compact(value) {
  return String(value).replace(/\s+/g, " ");
}

const {
  automaticLimitReason,
  buildCustomerDebtReminderMessage,
  classifyScheduledReminder,
  defaultDebtReminderSettings,
  normalizeDebtReminderSettings,
} = require("../services/debtReminderService");

test("debt reminder settings enforce professional safe defaults", () => {
  const defaults = defaultDebtReminderSettings();

  assert.equal(defaults.automatic_sms_enabled, false);
  assert.equal(defaults.manual_sms_enabled, true);
  assert.equal(defaults.manual_whatsapp_enabled, true);
  assert.deepEqual(defaults.due_soon_days, [7, 3, 1]);
  assert.equal(defaults.max_sms_7_days, 3);
  assert.equal(defaults.max_sms_30_days, 8);
  assert.equal(defaults.minimum_hours_between_sms, 24);
  assert.equal(defaults.timezone, "Africa/Accra");
});

test("settings normalization limits frequency and requires useful placeholders", () => {
  const settings = normalizeDebtReminderSettings({
    automatic_sms_enabled: true,
    due_soon_days: [30, 7, 3, 3, 1, -2, 800],
    max_sms_7_days: 999,
    max_sms_30_days: 9999,
    minimum_hours_between_sms: 0,
    reminder_time: "09:30",
    message_template:
      "Dear {customer_name}, outstanding GHS {outstanding_balance}. {due_sentence}",
  });

  assert.equal(settings.automatic_sms_enabled, true);
  assert.deepEqual(settings.due_soon_days, [30, 7, 3, 1]);
  assert.equal(settings.max_sms_7_days, 50);
  assert.equal(settings.max_sms_30_days, 200);
  assert.equal(settings.minimum_hours_between_sms, 1);
  assert.equal(settings.reminder_time, "09:30");

  assert.throws(
    () =>
      normalizeDebtReminderSettings({
        message_template: "Please pay soon",
      }),
    /must contain \{customer_name\} and \{outstanding_balance\}/
  );
});

test("scheduled reminders classify due-soon, due-today and overdue customers", () => {
  const settings = normalizeDebtReminderSettings({
    due_soon_days: [7, 3, 1],
    overdue_start_days: 1,
    overdue_repeat_days: 3,
  });

  assert.equal(
    classifyScheduledReminder(
      { overdue_count: 0, next_due_date: "2026-08-04" },
      settings,
      "2026-08-01"
    ).type,
    "due_soon"
  );
  assert.equal(
    classifyScheduledReminder(
      { overdue_count: 0, next_due_date: "2026-08-01" },
      settings,
      "2026-08-01"
    ).type,
    "due_today"
  );
  assert.equal(
    classifyScheduledReminder(
      {
        overdue_count: 2,
        earliest_overdue_date: "2026-07-28",
        next_due_date: null,
      },
      settings,
      "2026-08-01"
    ).type,
    "overdue"
  );
});

test("automatic limits stop excessive customer reminders", () => {
  const settings = normalizeDebtReminderSettings({
    max_sms_7_days: 3,
    max_sms_30_days: 8,
    minimum_hours_between_sms: 24,
  });

  assert.equal(
    automaticLimitReason(
      { count_7_days: 3, count_30_days: 3, last_sent_at: null },
      settings
    ),
    "maximum_7_day_limit"
  );
  assert.equal(
    automaticLimitReason(
      { count_7_days: 1, count_30_days: 8, last_sent_at: null },
      settings
    ),
    "maximum_30_day_limit"
  );

  const now = new Date("2026-08-01T12:00:00Z");
  assert.equal(
    automaticLimitReason(
      {
        count_7_days: 1,
        count_30_days: 1,
        last_sent_at: "2026-08-01T02:00:00Z",
      },
      settings,
      now
    ),
    "minimum_hours_not_reached"
  );
});

test("customer reminder message is consolidated and uses Ghana debt figures", () => {
  const settings = normalizeDebtReminderSettings({});
  const message = buildCustomerDebtReminderMessage({
    customer: {
      customer_name: "Mr Fred",
      outstanding_balance: 11600,
      total_owed: 15000,
      total_paid: 3400,
      debt_count: 2,
      overdue_count: 1,
      earliest_overdue_date: "2026-07-25",
      next_due_date: "2026-08-02",
    },
    branch: {
      branch_name: "Chalin 03 Main Store",
      branch_code: "MAIN",
      payment_phone: "0543421127",
    },
    settings,
    reminder: {
      type: "overdue",
      target_date: "2026-07-25",
      days: 7,
    },
  });

  assert.match(message, /Dear Mr Fred/);
  assert.match(message, /GHS 11,600\.00/);
  assert.match(message, /2 debt receipt/);
  assert.match(message, /overdue/);
  assert.match(message, /0543421127/);
  assert.ok(message.length <= 480);
});

test("protected reminder routes expose settings, run, history and customer actions", () => {
  const route = read("backend", "routes", "debtReminderRoutes.js");

  assert.match(route, /router\.get\(\s*"\/settings"/);
  assert.match(route, /router\.put\(\s*"\/settings"/);
  assert.match(route, /router\.get\(\s*"\/preview"/);
  assert.match(route, /router\.post\(\s*"\/run"/);
  assert.match(route, /router\.get\(\s*"\/history"/);
  assert.match(route, /"\/customer\/:customerId\/message"/);
  assert.match(route, /"\/customer\/:customerId\/sms"/);
  assert.match(route, /requireRole\("admin", "manager"\)/);
  assert.match(route, /SEND DEBT REMINDERS/);
  assert.match(route, /automatic_whatsapp_available: false/);
  assert.match(route, /req\.user\?\.branch_id/);
  assert.doesNotMatch(route, /req\.headers\["x-branch-id"\]/);
  assert.doesNotMatch(route, /req\.body\?\.branch_id/);
});

test("scheduler stores settings safely and deduplicates automatic SMS", () => {
  const service = read("backend", "services", "debtReminderService.js");

  assert.match(service, /group_configuration/);
  assert.match(service, /group_configuration_history/);
  assert.match(service, /GET_LOCK/);
  assert.match(service, /debt-customer:\$\{customer\.customer_id\}:scheduled/);
  assert.match(service, /max_sms_7_days/);
  assert.match(service, /max_sms_30_days/);
  assert.match(service, /minimum_hours_between_sms/);
  assert.match(service, /MANUAL_DEBT_SMS_LIMIT_REACHED/);
  assert.match(service, /startDebtReminderScheduler/);
});

test("server and consolidated customer UI expose reconciled debt reminders", () => {
  const server = read("backend", "server.js");
  const source = compact(server);
  const component = read(
    "frontend",
    "src",
    "components",
    "CustomerDebtConsolidationPanel.jsx"
  );
  const settingsPanel = read(
    "frontend",
    "src",
    "components",
    "DebtReminderSettingsPanel.jsx"
  );
  const css = read(
    "frontend",
    "src",
    "styles",
    "debtReminderSettings.css"
  );
  const sw = read("frontend", "public", "sw.js");

  assert.match(server, /debtReminderRoutes/);
  assert.match(
    source,
    /"\/api\/debt-reminders", requireAuth, sparePartsBoundary, reconcileCreditReturnDebts, debtReminderRoutes/
  );
  assert.match(server, /startDebtReminderScheduler\(\)/);
  assert.match(component, /DebtReminderSettingsPanel/);
  assert.match(component, /Send SMS Reminder/);
  assert.match(component, /WhatsApp Reminder/);
  assert.match(component, /\/debt-reminders\/customer\/\$\{customerId\}\/sms/);
  assert.match(settingsPanel, /Automatic SMS reminders/);
  assert.match(settingsPanel, /Maximum SMS in 7 Days/);
  assert.match(settingsPanel, /Minimum Hours Between SMS/);
  assert.match(settingsPanel, /Run Reminders Now/);
  assert.match(settingsPanel, /approved Meta WhatsApp Business API/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(
    sw,
    /new URL\(self\.location\.href\)\.searchParams\.get\("release"\)/
  );
  assert.match(sw, /isBuildAssetRequest\(request, url\)/);
  assert.match(sw, /CHALIN03_ASSET_MISMATCH/);
});
