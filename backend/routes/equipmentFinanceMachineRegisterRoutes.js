const express = require("express");

const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  installFinanceImageCompatibility,
  normalizePhotoPayload,
} = require("../services/equipmentFinanceImageCompatibilityService");

// Install before the professional routes module is loaded by the parent router,
// so signatures and issued document downloads also receive PDF-safe images.
installFinanceImageCompatibility();

const {
  createFinanceMachine,
  machineLocations,
  updateFinanceMachine,
} = require("../services/equipmentFinanceMachineRegisterService");
const {
  listProfessionalMachines,
} = require("../services/equipmentFinanceProfessionalService");

const router = express.Router();

function userId(req) {
  const id = Number(req.user?.id || 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function sendError(res, error, fallback) {
  return res.status(Number(error.statusCode || 500)).json({
    status: "error",
    code: error.code || "EQUIPMENT_FINANCE_MACHINE_REGISTER_ERROR",
    message: error.message || fallback,
    ...(error.readiness ? { readiness: error.readiness } : {}),
  });
}

router.get("/", requirePermission("fleet.assets.view"), async (req, res) => {
  try {
    const machines = await listProfessionalMachines({
      search: req.query.search,
      status: req.query.status,
      limit: req.query.limit,
    });
    return res.json({
      status: "success",
      count: machines.length,
      machines,
      image_policy: {
        crop: false,
        object_fit: "contain",
        protected_photo_limit_bytes: 48128,
        stored_formats: ["image/jpeg", "image/png"],
        legacy_webp_download_compatibility: true,
      },
    });
  } catch (error) {
    return sendError(res, error, "Could not load the Finance Machine Register.");
  }
});

router.get("/locations", requirePermission("fleet.assets.view"), async (_req, res) => {
  try {
    const locations = await machineLocations();
    return res.json({ status: "success", locations });
  } catch (error) {
    return sendError(res, error, "Could not load equipment yards/locations.");
  }
});

router.post("/", requirePermission("fleet.assets.manage"), async (req, res) => {
  try {
    const input = await normalizePhotoPayload(req.body || {});
    const machine = await createFinanceMachine({
      input,
      userId: userId(req),
      req,
    });
    return res.status(201).json({
      status: "success",
      message:
        "Excavator registered with its complete identity and uncropped, document-compatible photo evidence.",
      machine,
    });
  } catch (error) {
    return sendError(res, error, "Could not register the Finance machine.");
  }
});

router.put("/:assetId", requirePermission("fleet.assets.manage"), async (req, res) => {
  try {
    const input = await normalizePhotoPayload(req.body || {});
    const machine = await updateFinanceMachine({
      assetId: req.params.assetId,
      input,
      userId: userId(req),
      req,
    });
    return res.json({
      status: "success",
      message: "Finance machine identity and photo evidence updated.",
      machine,
    });
  } catch (error) {
    return sendError(res, error, "Could not update the Finance machine.");
  }
});

module.exports = router;
