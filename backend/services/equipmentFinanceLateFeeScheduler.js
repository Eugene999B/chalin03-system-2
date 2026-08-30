const { listPendingLateFees } = require("./equipmentFinanceLateFeePolicyService");

const INSTALL_FLAG = Symbol.for("chalin03.equipmentFinanceLateFeeSchedulerInstalled");
let scheduler = null;

async function runEquipmentFinanceLateFeeEvaluation() {
  try {
    const pending = await listPendingLateFees();
    if (pending.length) {
      console.log(`Finance late-fee policy: ${pending.length} decision(s) waiting for management.`);
    } else {
      console.log("Finance late-fee policy: evaluation complete; no management decisions waiting.");
    }
    return pending;
  } catch (error) {
    console.error("Finance late-fee policy evaluation failed:", error.message);
    return [];
  }
}

function startEquipmentFinanceLateFeeScheduler() {
  if (globalThis[INSTALL_FLAG] || scheduler) return false;
  if (String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production") return false;

  const intervalMinutes = Math.max(
    5,
    Number(process.env.EQUIPMENT_FINANCE_LATE_FEE_INTERVAL_MINUTES || 15)
  );

  scheduler = setInterval(() => {
    void runEquipmentFinanceLateFeeEvaluation();
  }, intervalMinutes * 60 * 1000);
  scheduler.unref?.();

  Object.defineProperty(globalThis, INSTALL_FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  // Run once shortly after the application has loaded so a newly crossed
  // grace-period boundary is recognised without waiting for the next cycle.
  setTimeout(() => {
    void runEquipmentFinanceLateFeeEvaluation();
  }, 20 * 1000).unref?.();

  console.log(`Finance late-fee policy scheduler started (${intervalMinutes} minute interval).`);
  return true;
}

module.exports = {
  runEquipmentFinanceLateFeeEvaluation,
  startEquipmentFinanceLateFeeScheduler,
};
