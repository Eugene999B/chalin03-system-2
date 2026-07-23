require("dotenv").config();

const {
  ensureCommercialSalesSchema,
  safeRepairError,
} = require("./equipmentSalesCommercialRepairService");

const BOOT_DELAY_MS = 2 * 1000;
const RETRY_DELAY_MS = 60 * 1000;

let timer = null;
let ready = false;
let running = false;
let requestRepairPromise = null;

function disabled() {
  return (
    String(process.env.NODE_ENV || "").trim().toLowerCase() === "test" ||
    String(process.env.DISABLE_EQUIPMENT_SALES_COMMERCIAL_REPAIR || "")
      .trim()
      .toLowerCase() === "true"
  );
}

function commercialRepairOnce() {
  if (!requestRepairPromise) {
    requestRepairPromise = ensureCommercialSalesSchema().catch((error) => {
      requestRepairPromise = null;
      throw error;
    });
  }
  return requestRepairPromise;
}

function installEquipmentSalesRequestGate() {
  if (disabled()) return false;

  const schemaService = require("./equipmentSalesSchemaService");
  if (schemaService.__chalin03CommercialColumnGateInstalled) return true;

  const ensureCatalogueFoundation = schemaService.ensureEquipmentSalesSchema;

  schemaService.ensureEquipmentSalesSchema = async function ensureEquipmentSalesSchemaWithCommercialColumns(
    ...args
  ) {
    const catalogueStatus = await ensureCatalogueFoundation(...args);
    const commercialStatus = await commercialRepairOnce();
    ready = Boolean(commercialStatus?.ready);

    if (ready && timer) {
      clearTimeout(timer);
      timer = null;
    }

    return {
      ...catalogueStatus,
      full_ready: ready,
      commercial: commercialStatus,
    };
  };

  Object.defineProperty(
    schemaService,
    "__chalin03CommercialColumnGateInstalled",
    {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    }
  );

  return true;
}

function schedule(delayMs = BOOT_DELAY_MS) {
  if (disabled() || ready || running || timer) return false;

  timer = setTimeout(async () => {
    timer = null;
    running = true;

    try {
      const result = await commercialRepairOnce();
      ready = Boolean(result?.ready);
      console.log(
        `Equipment Sales commercial schema ${ready ? "ready" : "pending"}; ` +
          `created=${result?.created_tables?.length || 0}, ` +
          `repaired_columns=${result?.repaired_columns?.length || 0}, ` +
          `index_warnings=${result?.index_warnings?.length || 0}.`
      );
    } catch (error) {
      ready = false;
      console.error(
        "Equipment Sales commercial schema repair failed; Catalogue and Hire remain available:",
        safeRepairError(error)
      );
    } finally {
      running = false;
      if (!ready) schedule(RETRY_DELAY_MS);
    }
  }, Math.max(1000, Number(delayMs) || BOOT_DELAY_MS));

  timer.unref?.();
  return true;
}

installEquipmentSalesRequestGate();
schedule();

module.exports = {
  BOOT_DELAY_MS,
  RETRY_DELAY_MS,
  commercialRepairOnce,
  installEquipmentSalesRequestGate,
  schedule,
};
