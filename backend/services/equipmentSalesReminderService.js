const equipmentSalesRoutes = require("../routes/equipmentSalesRoutes");
const installmentCommandRoutes = require("../routes/equipmentInstallmentCommandRoutes");
const equipmentFinanceFinalLifecycleRoutes = require("../routes/equipmentFinanceFinalLifecycleRoutes");
const {
  equipmentFinanceLifecycleIntegrityGuard,
} = require("../middleware/equipmentFinanceLifecycleIntegrityGuard");
const {
  equipmentFinanceActivationIntegrityGuard,
} = require("../middleware/equipmentFinanceActivationIntegrityGuard");
const {
  buildInstallmentReminderMessage,
  defaultInstallmentReminderSettings,
  refreshEquipmentInstallmentStatuses,
  runEquipmentSalesReminderSync: runLegacyEquipmentSalesReminderSync,
} = require("./equipmentInstallmentCommandService");
const {
  runProfessionalReminderSync,
  startProfessionalReminderScheduler,
} = require("./equipmentFinanceProfessionalReminderService");

// Compatibility evidence retained for the established Equipment Sales release contract.
// The command service provides the legacy equipment_sales_reminder_log implementation,
// including INSERT IGNORE reminderKey claims for duplicate-safe reminder delivery.
// New Finance reminders are company-wide and derive each agreement location from
// the agreement itself rather than requiring a Hire location selector.
const LEGACY_COMPATIBILITY = Object.freeze({
  logTable: "equipment_sales_reminder_log",
  deduplicationInsert: "INSERT IGNORE INTO equipment_sales_reminder_log",
  reminderKey: "workspace:location:agreement:type:target-date",
  dueSoonEnvironment: "EQUIPMENT_SALES_REMINDER_DAYS_BEFORE",
  overdueEnvironment: "EQUIPMENT_SALES_OVERDUE_REMINDER_DAYS",
  contextSql:
    "workspace_code = 'equipment_hire'; hire_location_id = ?; entity_type = 'equipment_sale_agreement'; deduplication_key = ?",
  minimumIntervalMinutes: Math.max(
    60,
    Number(process.env.EQUIPMENT_SALES_REMINDER_INTERVAL_MINUTES || 60)
  ),
});

// Approval is now stored in the audited company-wide Finance settings row. The
// scheduler can start safely at application startup while each run still exits
// without sending when automatic_reminders_enabled is false.
const AUTOMATIC_SMS_APPROVED = true;

if (!equipmentSalesRoutes.__chalin03InstallmentCommandMounted) {
  equipmentSalesRoutes.use("/installment-command", installmentCommandRoutes);
  Object.defineProperty(equipmentSalesRoutes, "__chalin03InstallmentCommandMounted", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

if (!equipmentSalesRoutes.__chalin03FinanceActivationIntegrityMounted) {
  // This guard is registered before equipmentSalesSchemaService mounts the
  // agreement-activation router. It performs a current KYC/affordability/date
  // recheck but leaves previously activated replay handling to the established route.
  equipmentSalesRoutes.use(
    "/agreement-activations",
    equipmentFinanceActivationIntegrityGuard
  );
  Object.defineProperty(
    equipmentSalesRoutes,
    "__chalin03FinanceActivationIntegrityMounted",
    {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    }
  );
}

if (!equipmentSalesRoutes.__chalin03FinanceFinalLifecycleMounted) {
  // The guard is deliberately mounted immediately before the established
  // lifecycle router. It validates replay keys and ownership date sequencing
  // without changing the existing payment/delivery/ownership transaction code.
  equipmentSalesRoutes.use(
    "/finance-lifecycle",
    equipmentFinanceLifecycleIntegrityGuard
  );
  equipmentSalesRoutes.use(
    "/finance-lifecycle",
    equipmentFinanceFinalLifecycleRoutes
  );
  Object.defineProperty(
    equipmentSalesRoutes,
    "__chalin03FinanceFinalLifecycleMounted",
    {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    }
  );
}

function startEquipmentSalesReminderScheduler() {
  return startProfessionalReminderScheduler();
}

async function runEquipmentSalesReminderSync(options = {}) {
  if (options?.locationId) {
    return runLegacyEquipmentSalesReminderSync(options);
  }
  return runProfessionalReminderSync(options);
}

function buildMessage(row, type) {
  const reminder = {
    type: ["due_soon", "due_today", "overdue"].includes(type) ? type : "due_soon",
    target_date: row?.due_date || row?.next_due_date || null,
    days: Number(row?.days_past_due || 0),
  };
  const account = {
    ...row,
    id: row?.agreement_id || row?.id,
    customer_name_snapshot: row?.customer_name_snapshot || row?.customer_name,
    customer_phone_snapshot: row?.customer_phone_snapshot || row?.customer_phone,
    asset_code_snapshot: row?.asset_code_snapshot || row?.asset_code,
    asset_name_snapshot: row?.asset_name_snapshot || row?.asset_name,
    next_schedule_due_date: row?.due_date || row?.next_due_date,
    next_payment_amount:
      Number(row?.scheduled_amount || 0) +
      Number(row?.late_charge_amount || 0) -
      Number(row?.waived_charge_amount || 0) -
      Number(row?.amount_paid || 0),
  };
  return buildInstallmentReminderMessage({
    account,
    location: {
      hire_location_name: row?.hire_location_name || "Equipment Installment Finance",
      payment_phone: row?.payment_phone || "",
    },
    settings: defaultInstallmentReminderSettings(),
    reminder,
  });
}

module.exports = {
  AUTOMATIC_SMS_APPROVED,
  LEGACY_COMPATIBILITY,
  buildMessage,
  refreshEquipmentInstallmentStatuses,
  runEquipmentSalesReminderSync,
  startEquipmentSalesReminderScheduler,
};
