const express = require("express");

const { requireAuth } = require("../middleware/authMiddleware");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");

const router = express.Router();
const RETIREMENT_CODE = "WEB_BUSINESS_DATA_CLEAR_RETIRED";

function requireOriginalSystemAdministrator(req, res, next) {
  if (!isOriginalSystemAdministrator(req.user)) {
    return res.status(403).json({
      status: "error",
      code: "SYSTEM_ADMINISTRATOR_REQUIRED",
      message:
        "Only the permanently protected original System Administrator can view data-maintenance controls.",
    });
  }
  return next();
}

function retirementPayload() {
  return {
    status: "success",
    code: RETIREMENT_CODE,
    retired: true,
    clear_enabled: false,
    system_admin_only: true,
    message:
      "Web-based business-data clearing has been permanently retired because Chalin 03 is a live production system.",
    recovery_policy: [
      "Business records must never be cleared from a web page or by enabling a Railway flag.",
      "Approved corrections use the business workflow, audit unlock, reversal or void process.",
      "Disaster recovery uses a validated full-system backup during a controlled restore window.",
      "Database maintenance requiring destructive SQL must be performed offline against a verified backup and documented change ticket.",
    ],
  };
}

// GET /api/maintenance/business-data-summary
// Kept as a read-only compatibility endpoint so older frontend builds receive a
// clear retirement notice rather than attempting to expose destructive controls.
router.get(
  "/business-data-summary",
  requireAuth,
  requireOriginalSystemAdministrator,
  (_req, res) => res.json(retirementPayload())
);

// DELETE /api/maintenance/clear-business-data
// Permanently unavailable in every environment, including local and Railway.
router.delete(
  "/clear-business-data",
  requireAuth,
  requireOriginalSystemAdministrator,
  (_req, res) =>
    res.status(410).json({
      ...retirementPayload(),
      status: "error",
      message:
        "This destructive web action is permanently unavailable. Use audited correction workflows or controlled disaster recovery.",
    })
);

module.exports = router;
