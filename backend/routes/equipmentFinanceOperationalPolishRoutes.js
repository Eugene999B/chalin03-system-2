const express = require("express");

const { requirePermission } = require("../middleware/permissionMiddleware");
const { workspaceRoleFor } = require("../security/equipmentDivisionAccess");
const {
  OperationalPolishError,
  applyAmendment,
  archiveDraft,
  createAmendment,
  createIssuedDocumentShare,
  createPaymentShare,
  createTask,
  decideAmendment,
  getCaseDocument,
  getCaseOperations,
  getDataQualityAlerts,
  getDraft,
  getOperationalBootstrap,
  getPaymentReceipt,
  issuePaymentReceipt,
  listAmendments,
  listCaseDocuments,
  listCases,
  listInbox,
  listScheduleSimulations,
  operationalPolishSchemaStatus,
  reviewCaseDocument,
  retryBossPaymentAlert,
  saveDraft,
  saveScheduleSimulation,
  simulateSchedule,
  updateTask,
  uploadCaseDocument,
} = require("../services/equipmentFinanceOperationalPolishService");

const router = express.Router();
const PREFIX = "/operational-polish";

function userId(req) {
  const id = Number(req.user?.id || 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function sendError(res, error, fallback) {
  const statusCode = Number(error.statusCode || 500);
  const payload = {
    status: "error",
    code: error.code || "EQUIPMENT_FINANCE_OPERATIONAL_POLISH_ERROR",
    message: error.message || fallback,
  };
  if (error.readiness) payload.readiness = error.readiness;
  if (error.current_draft) payload.current_draft = error.current_draft;
  return res.status(statusCode).json(payload);
}

router.get(
  `${PREFIX}/readiness`,
  requirePermission("fleet.assets.view"),
  async (_req, res) => {
    try {
      const readiness = await operationalPolishSchemaStatus();
      return res.status(readiness.ready ? 200 : 503).json({
        status: readiness.ready ? "success" : "warning",
        readiness,
      });
    } catch (error) {
      return sendError(res, error, "Could not check Phase 3 Finance readiness.");
    }
  }
);

router.get(
  `${PREFIX}/bootstrap`,
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const result = await getOperationalBootstrap({
        userId: userId(req),
        workspaceRole: workspaceRoleFor(req.user),
      });
      return res.json({ status: "success", ...result });
    } catch (error) {
      return sendError(res, error, "Could not load Finance operational controls.");
    }
  }
);

router.get(
  `${PREFIX}/drafts/start-installment`,
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const draft = await getDraft({
        userId: userId(req),
        draftKey: "start-installment",
      });
      return res.json({ status: "success", draft });
    } catch (error) {
      return sendError(res, error, "Could not load the server draft.");
    }
  }
);

router.put(
  `${PREFIX}/drafts/start-installment`,
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const draft = await saveDraft({
        userId: userId(req),
        draftKey: "start-installment",
        payload: req.body?.payload,
        knownVersion: req.body?.known_version,
      });
      return res.json({
        status: "success",
        message: "Installment draft saved securely to the server.",
        draft,
      });
    } catch (error) {
      return sendError(res, error, "Could not autosave the installment draft.");
    }
  }
);

router.delete(
  `${PREFIX}/drafts/start-installment`,
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const result = await archiveDraft({
        userId: userId(req),
        draftKey: "start-installment",
        submitted: String(req.query.submitted || "").toLowerCase() === "true",
      });
      return res.json({
        status: "success",
        message: result.archived ? "Server draft archived." : "No active server draft remained.",
        ...result,
      });
    } catch (error) {
      return sendError(res, error, "Could not archive the server draft.");
    }
  }
);

router.get(
  `${PREFIX}/cases`,
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const cases = await listCases({ limit: req.query.limit });
      return res.json({ status: "success", count: cases.length, cases });
    } catch (error) {
      return sendError(res, error, "Could not load Finance cases.");
    }
  }
);

router.get(
  `${PREFIX}/cases/:caseType/:caseId`,
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const result = await getCaseOperations(req.params.caseType, req.params.caseId);
      return res.json({ status: "success", ...result });
    } catch (error) {
      return sendError(res, error, "Could not load the complete Finance case.");
    }
  }
);

router.get(
  `${PREFIX}/cases/:caseType/:caseId/documents`,
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const documents = await listCaseDocuments(req.params.caseType, req.params.caseId);
      return res.json({ status: "success", count: documents.length, documents });
    } catch (error) {
      return sendError(res, error, "Could not load protected case documents.");
    }
  }
);

router.post(
  `${PREFIX}/cases/:caseType/:caseId/documents`,
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const document = await uploadCaseDocument({
        caseType: req.params.caseType,
        caseId: req.params.caseId,
        userId: userId(req),
        body: req.body || {},
        req,
      });
      return res.status(201).json({
        status: "success",
        message: "Document uploaded to private Finance storage with a verified checksum.",
        document,
      });
    } catch (error) {
      return sendError(res, error, "Could not upload the protected Finance document.");
    }
  }
);

router.get(
  `${PREFIX}/documents/:documentId/download`,
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const document = await getCaseDocument(req.params.documentId);
      const safeName = String(document.original_file_name || "finance-evidence")
        .replace(/[\r\n"\\/]/g, "-")
        .slice(0, 180);
      res.setHeader("Content-Type", document.stored_mime_type);
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Document-Checksum", document.checksum_sha256);
      return res.send(document.file_content);
    } catch (error) {
      return sendError(res, error, "Could not download the protected Finance document.");
    }
  }
);

router.patch(
  `${PREFIX}/documents/:documentId/review`,
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const document = await reviewCaseDocument({
        documentId: req.params.documentId,
        userId: userId(req),
        body: req.body || {},
        req,
      });
      return res.json({
        status: "success",
        message: `Document ${document.document_status}.`,
        document,
      });
    } catch (error) {
      return sendError(res, error, "Could not review the Finance document.");
    }
  }
);

router.get(
  `${PREFIX}/inbox`,
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const inbox = await listInbox({
        userId: userId(req),
        workspaceRole: workspaceRoleFor(req.user),
      });
      return res.json({ status: "success", ...inbox });
    } catch (error) {
      return sendError(res, error, "Could not load the Finance task and approval inbox.");
    }
  }
);

router.post(
  `${PREFIX}/tasks`,
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const task = await createTask({
        userId: userId(req),
        body: req.body || {},
        req,
      });
      return res.status(201).json({
        status: "success",
        message: "Finance task added to the controlled inbox.",
        task,
      });
    } catch (error) {
      return sendError(res, error, "Could not create the Finance task.");
    }
  }
);

router.patch(
  `${PREFIX}/tasks/:taskId`,
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const task = await updateTask({
        taskId: req.params.taskId,
        userId: userId(req),
        body: req.body || {},
        req,
      });
      return res.json({
        status: "success",
        message: "Finance task updated with timeline and audit evidence.",
        task,
      });
    } catch (error) {
      return sendError(res, error, "Could not update the Finance task.");
    }
  }
);

router.get(
  `${PREFIX}/alerts`,
  requirePermission("fleet.assets.view"),
  async (_req, res) => {
    try {
      const alerts = await getDataQualityAlerts();
      return res.json({ status: "success", count: alerts.length, alerts });
    } catch (error) {
      return sendError(res, error, "Could not load Finance data-quality alerts.");
    }
  }
);

router.post(
  `${PREFIX}/schedule/simulate`,
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const simulation = simulateSchedule(req.body || {});
      return res.json({ status: "success", simulation });
    } catch (error) {
      return sendError(res, error, "Could not calculate the payment schedule.");
    }
  }
);

router.post(
  `${PREFIX}/schedule/simulations`,
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const simulation = await saveScheduleSimulation({
        userId: userId(req),
        body: req.body || {},
      });
      return res.status(201).json({
        status: "success",
        message: "Schedule simulation saved as checksum-protected planning evidence.",
        simulation,
      });
    } catch (error) {
      return sendError(res, error, "Could not save the schedule simulation.");
    }
  }
);

router.get(
  `${PREFIX}/cases/:caseType/:caseId/simulations`,
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const simulations = await listScheduleSimulations(
        req.params.caseType,
        req.params.caseId
      );
      return res.json({ status: "success", count: simulations.length, simulations });
    } catch (error) {
      return sendError(res, error, "Could not load saved schedule simulations.");
    }
  }
);

router.get(
  `${PREFIX}/cases/:caseType/:caseId/amendments`,
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const amendments = await listAmendments(req.params.caseType, req.params.caseId);
      return res.json({ status: "success", count: amendments.length, amendments });
    } catch (error) {
      return sendError(res, error, "Could not load Finance amendments.");
    }
  }
);

router.post(
  `${PREFIX}/cases/:caseType/:caseId/amendments`,
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const amendment = await createAmendment({
        caseType: req.params.caseType,
        caseId: req.params.caseId,
        userId: userId(req),
        body: req.body || {},
        req,
      });
      return res.status(201).json({
        status: "success",
        message: "Numbered amendment submitted for independent approval.",
        amendment,
      });
    } catch (error) {
      return sendError(res, error, "Could not submit the Finance amendment.");
    }
  }
);

router.patch(
  `${PREFIX}/amendments/:amendmentId/decision`,
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const amendment = await decideAmendment({
        amendmentId: req.params.amendmentId,
        userId: userId(req),
        body: req.body || {},
        req,
      });
      return res.json({
        status: "success",
        message: `Amendment ${amendment.amendment_status}.`,
        amendment,
      });
    } catch (error) {
      return sendError(res, error, "Could not decide the Finance amendment.");
    }
  }
);

router.post(
  `${PREFIX}/amendments/:amendmentId/apply`,
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const amendment = await applyAmendment({
        amendmentId: req.params.amendmentId,
        userId: userId(req),
        req,
      });
      return res.json({
        status: "success",
        message:
          amendment.apply_mode === "direct_safe_update"
            ? "Approved safe correction applied with the original snapshot preserved."
            : "Approved financial variation added to the case file without rewriting original money records.",
        amendment,
      });
    } catch (error) {
      return sendError(res, error, "Could not apply the Finance amendment.");
    }
  }
);

router.get(
  `${PREFIX}/payments/:paymentId/receipt`,
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const receipt = await getPaymentReceipt(req.params.paymentId);
      return res.json({ status: "success", ...receipt });
    } catch (error) {
      return sendError(res, error, "Could not load the installment payment receipt.");
    }
  }
);

router.post(
  `${PREFIX}/payments/:paymentId/receipt/issue`,
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const document = await issuePaymentReceipt({
        paymentId: req.params.paymentId,
        userId: userId(req),
      });
      return res.status(201).json({
        status: "success",
        message: "Thermal payment receipt issued from an immutable snapshot.",
        document,
      });
    } catch (error) {
      return sendError(res, error, "Could not issue the payment receipt.");
    }
  }
);

router.post(
  `${PREFIX}/payments/:paymentId/share`,
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const share = await createPaymentShare({
        paymentId: req.params.paymentId,
        userId: userId(req),
        body: req.body || {},
        req,
      });
      return res.status(201).json({
        status: share.status === "failed" ? "warning" : "success",
        message:
          share.status === "failed"
            ? "The share attempt was recorded but was not sent."
            : "Receipt sharing evidence recorded.",
        share,
      });
    } catch (error) {
      return sendError(res, error, "Could not share the payment receipt.");
    }
  }
);

router.post(
  `${PREFIX}/payments/:paymentId/boss-alert/retry`,
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const receipt = await getPaymentReceipt(req.params.paymentId);
      const alert = await retryBossPaymentAlert({
        paymentId: receipt.payment.id,
        agreementId: receipt.payment.agreement_id,
        userId: userId(req),
      });
      return res.json({
        status: alert.ok ? "success" : "warning",
        message: alert.ok
          ? "Boss payment alert accepted after the committed payment."
          : "The payment remains valid, but the boss alert was not accepted.",
        boss_payment_alert: alert,
      });
    } catch (error) {
      return sendError(res, error, "Could not retry the boss payment alert.");
    }
  }
);

router.post(
  `${PREFIX}/issued-documents/:documentId/share`,
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const share = await createIssuedDocumentShare({
        documentId: req.params.documentId,
        userId: userId(req),
        body: req.body || {},
        req,
      });
      return res.status(201).json({
        status: share.status === "failed" ? "warning" : "success",
        message:
          share.status === "failed"
            ? "The document share was recorded but could not be sent."
            : "Document sharing evidence recorded.",
        share,
      });
    } catch (error) {
      return sendError(res, error, "Could not share the issued Finance document.");
    }
  }
);

router.use((error, _req, res, next) => {
  if (error instanceof OperationalPolishError) {
    return sendError(res, error, "Finance operational request failed.");
  }
  return next(error);
});

module.exports = router;
