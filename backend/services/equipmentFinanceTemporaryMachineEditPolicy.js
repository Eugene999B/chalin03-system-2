// Temporary, reversible correction window for equipment already linked to Installment Finance.
// Restore this flag to false after management finishes correcting the machine register.
// This does NOT unlock agreements, schedules, payments, receipts or signed documents.
const TEMPORARY_FINANCE_MACHINE_CORRECTIONS_ENABLED = true;

function getFinanceMachineEditability(machine = {}) {
  const saleStatus = String(machine.sale_status || "").toLowerCase();
  const activeHire = Number(machine.active_hire_count || 0) > 0;
  const hasFinanceReference =
    Number(machine.active_application_count || 0) > 0 ||
    Number(machine.active_sale_lock_count || 0) > 0 ||
    Number(machine.active_agreement_count || 0) > 0;

  if (activeHire || !["available", "reserved", "installment_active"].includes(saleStatus)) {
    return { editable: false, temporary_correction: false };
  }
  if (!hasFinanceReference && saleStatus === "available") {
    return { editable: true, temporary_correction: false };
  }
  if (!hasFinanceReference || !TEMPORARY_FINANCE_MACHINE_CORRECTIONS_ENABLED) {
    return { editable: false, temporary_correction: false };
  }
  return { editable: true, temporary_correction: true };
}

module.exports = {
  TEMPORARY_FINANCE_MACHINE_CORRECTIONS_ENABLED,
  getFinanceMachineEditability,
};
