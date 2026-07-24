const {
  ensureEquipmentSalesSchema,
} = require("../services/equipmentSalesSchemaService");

function isEquipmentSalesRequest(req) {
  return /^\/sales(?:\/|$)/.test(String(req.path || ""));
}

async function requireEquipmentSalesReadiness(req, res, next) {
  if (!isEquipmentSalesRequest(req)) return next();

  try {
    const status = await ensureEquipmentSalesSchema();
    if (status?.full_ready) return next();

    return res.status(503).json({
      status: "error",
      code: "EQUIPMENT_SALES_SCHEMA_NOT_READY",
      message:
        "Equipment Sales is unavailable because its approved database migration is incomplete. Equipment Catalogue and normal Hire operations remain available.",
      missing_tables: status?.commercial?.missing_tables || [],
      missing_columns: status?.commercial?.missing_columns || [],
      optional_support_missing:
        status?.commercial?.optional_support_missing || [],
    });
  } catch (error) {
    console.error("Equipment Sales readiness verification failed:", {
      code: error?.code,
      message: error?.message,
      missing_tables: error?.missingTables,
      missing_columns: error?.missingColumns,
    });
    return res.status(503).json({
      status: "error",
      code: error?.code || "EQUIPMENT_SALES_SCHEMA_NOT_READY",
      message:
        "Equipment Sales is unavailable because its approved database migration could not be verified. Equipment Catalogue and normal Hire operations remain available.",
      missing_tables: error?.missingTables || [],
      missing_columns: error?.missingColumns || [],
    });
  }
}

module.exports = {
  isEquipmentSalesRequest,
  requireEquipmentSalesReadiness,
};
