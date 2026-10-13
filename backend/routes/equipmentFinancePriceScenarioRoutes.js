"use strict";

const express = require("express");
const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { canApplySaleDiscount } = require("../services/saleDiscountAuthorizationService");
const {
  loadAgreementSnapshot,
  renderAgreementPdf,
} = require("../services/equipmentFinanceProfessionalService");
const {
  priceScenario,
  summarizePriceScenario,
} = require("../services/equipmentFinancePriceScenarioService");

const router = express.Router();

// Pricing copies contain protected buyer data. Only the explicitly verified
// boss or original System Administrator can view or create them.
router.use(requirePermission("fleet.assets.view"));
router.use(async (req, res, next) => {
  try {
    if (await canApplySaleDiscount(req.user)) {
      res.set("Cache-Control", "private, no-store");
      return next();
    }
    return res.status(403).json({
      status: "error", code: "PRICE_DOCUMENT_BOSS_ONLY",
      message: "Only the Boss or original System Administrator can access price documents.",
    });
  } catch (error) {
    console.error("Price document authorization:", error);
    return res.status(503).json({
      status: "error", message: "Could not verify price document access.",
    });
  }
});

function err(res, error) {
  const status = Number(error?.statusCode || 500);
  return res.status(status >= 400 && status < 600 ? status : 500).json({
    status: "error",
    code: error?.code || "PRICE_DOCUMENT_FAILED",
    message: status >= 400 && status < 500 ? error.message :
      "Unable to prepare the document. The original account was not changed.",
  });
}

function safeId(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

router.get("/professional/price-documents/agreements", async (req, res) => {
  try {
    const term = String(req.query.search || "").trim().slice(0, 90);
    const limit = Math.max(1, Math.min(150, Number(req.query.limit) || 80));
    const params = [];
    const filter = term ? `
       AND (a.agreement_number LIKE ? OR a.asset_name_snapshot LIKE ?
            OR a.customer_name_snapshot LIKE ? OR f.asset_code LIKE ?)
    ` : "";
    if (term) params.push(...Array(4).fill(`%${term}%`));
    params.push(limit);
    const [rows] = await pool.query(
      `SELECT a.id, a.agreement_number, a.asset_name_snapshot,
              a.customer_name_snapshot, a.total_amount,
              a.deposit_required, a.payment_frequency, a.installment_count,
              a.created_at, f.asset_code
         FROM equipment_sale_agreements a
         LEFT JOIN fleet_assets f ON f.id = a.asset_id
        WHERE a.sale_type = 'installment'
          AND a.activation_source = 'approved_credit_application'
          ${filter}
        ORDER BY a.id DESC LIMIT ?`,
      params
    );
    return res.json({ status: "success", agreements: rows });
  } catch (error) {
    console.error("Price scenario agreement list:", error);
    return err(res, error);
  }
});

router.get("/professional/price-documents/:agreementId", async (req, res) => {
  try {
    if (!safeId(req.params.agreementId)) return res.status(400).json({ message: "Invalid agreement." });
    const source = await loadAgreementSnapshot(req.params.agreementId);
    const a = source.agreement;
    return res.json({
      status: "success",
      agreement: {
        id: a.id,
        agreement_number: a.agreement_number,
        asset_code: a.asset_code,
        asset_name: a.asset_name,
        customer_name: a.kyc_customer_name || a.customer_name_snapshot || a.customer_name,
        total_amount: Number(a.total_amount || 0),
        deposit_required: Number(a.deposit_required || 0),
        deposit_received: Number(a.deposit_received || 0),
        amount_paid: Number(a.amount_paid || 0),
        financed_amount: Number(a.financed_amount || 0),
        outstanding_balance: Number(a.outstanding_balance || 0),
        payment_frequency: a.payment_frequency,
        installment_count: Number(a.installment_count || 0),
      },
    });
  } catch (error) {
    console.error("Price scenario agreement detail:", error);
    return err(res, error);
  }
});

async function scenarioFromRequest(req) {
  if (!safeId(req.params.agreementId)) {
    const error = new Error("Invalid agreement.");
    error.statusCode = 400;
    throw error;
  }
  const source = await loadAgreementSnapshot(req.params.agreementId);
  return priceScenario(source, req.body?.price, req.body?.deposit);
}

router.post("/professional/price-documents/:agreementId/preview", async (req, res) => {
  try {
    const scenario = await scenarioFromRequest(req);
    return res.json({ status: "success", scenario: summarizePriceScenario(scenario) });
  } catch (error) {
    return err(res, error);
  }
});

router.post("/professional/price-documents/:agreementId/download", async (req, res) => {
  try {
    const snapshot = await scenarioFromRequest(req);
    // Distinct document reference; NEVER issue a replacement official agreement.
    const id = safeId(req.params.agreementId);
    const reference = `PRICE-COPY-${id}`;
    const pdf = await renderAgreementPdf(snapshot, reference);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Excavator-${id}-Price-Copy.pdf"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    });
    console.info("Boss price-only document downloaded", {
      agreementId: id, actorId: Number(req.user?.id), projectedPrice: snapshot.agreement.total_amount,
    });
    return res.send(pdf);
  } catch (error) {
    console.error("Price copy PDF:", error);
    return err(res, error);
  }
});

module.exports = router;
