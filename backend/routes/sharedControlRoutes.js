const express = require("express");

const { requireAuth } = require("../middleware/authMiddleware");
const {
  requirePermission,
  requireAnyPermission,
} = require("../middleware/permissionMiddleware");
const {
  buildSharedRoleAssurance,
  loadSharedControlEvidence,
  writeSharedControlEvidence,
} = require("../services/sharedControlService");

const router = express.Router();

function cleanText(value, maxLength = 500) {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, maxLength);
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value || "").trim().toLowerCase()
  );
}

router.use(requireAuth);

router.get(
  "/assurance",
  requirePermission("shared.control.view"),
  async (req, res, next) => {
    try {
      return res.json({
        status: "success",
        message: "Shared role and location assurance loaded.",
        assurance: buildSharedRoleAssurance(req),
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/evidence",
  requireAnyPermission(
    "shared.audit.view",
    "shared.documents.view",
    "shared.reports.view"
  ),
  async (req, res, next) => {
    try {
      const result = await loadSharedControlEvidence(req, {
        groupMode: truthy(req.query.group),
        from: req.query.from,
        to: req.query.to,
        controlArea: req.query.control_area,
        actionType: req.query.action_type,
        search: req.query.search,
        limit: req.query.limit,
      });

      return res.json({
        status: "success",
        evidence_available: result.available,
        scope: result.scope,
        evidence: result.rows,
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/overview",
  requirePermission("shared.control.view"),
  async (req, res, next) => {
    try {
      const assurance = buildSharedRoleAssurance(req);
      const history = await loadSharedControlEvidence(req, {
        groupMode: truthy(req.query.group),
        limit: 25,
      });

      const counts = history.rows.reduce(
        (summary, row) => {
          summary.total += 1;
          summary[row.control_area] = (summary[row.control_area] || 0) + 1;
          summary[row.action_type] = (summary[row.action_type] || 0) + 1;
          return summary;
        },
        { total: 0 }
      );

      return res.json({
        status: "success",
        assurance,
        evidence_available: history.available,
        evidence_scope: history.scope,
        evidence_summary: counts,
        recent_evidence: history.rows,
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/evidence",
  requirePermission("shared.control.view"),
  async (req, res, next) => {
    try {
      const allowedActions = new Set([
        "view",
        "open",
        "download",
        "reprint",
        "print",
        "export",
      ]);
      const allowedAreas = new Set(["documents", "reports", "audit"]);
      const actionType = cleanText(req.body?.action_type, 40).toLowerCase();
      const controlArea = cleanText(req.body?.control_area, 60).toLowerCase();

      if (!allowedActions.has(actionType) || !allowedAreas.has(controlArea)) {
        return res.status(400).json({
          status: "error",
          code: "INVALID_SHARED_EVIDENCE_ACTION",
          message: "Choose a supported document, report or audit action.",
        });
      }

      const recorded = await writeSharedControlEvidence({
        req,
        controlArea,
        actionType,
        documentType: cleanText(req.body?.document_type, 80) || null,
        documentId: positiveId(req.body?.document_id),
        documentNumber: cleanText(req.body?.document_number, 180) || null,
        exportFormat: cleanText(req.body?.export_format, 20) || null,
        description: cleanText(req.body?.description, 1000),
        metadata:
          req.body?.metadata && typeof req.body.metadata === "object"
            ? req.body.metadata
            : null,
      });

      return res.status(recorded ? 201 : 202).json({
        status: "success",
        evidence_recorded: recorded,
        message: recorded
          ? "Shared control evidence recorded."
          : "The action may continue; database evidence will become available after the Release 3E migration.",
      });
    } catch (error) {
      return next(error);
    }
  }
);

module.exports = router;
