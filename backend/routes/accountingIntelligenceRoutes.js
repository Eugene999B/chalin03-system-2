const express = require("express");

const { requireAuth } = require("../middleware/authMiddleware");
const {
  buildAccountingIntelligence,
} = require("../services/accountingIntelligenceService");
const {
  loadExpenseFundingEvidence,
} = require("../services/expenseFundingEvidenceService");

const router = express.Router();

/*
  Advanced Accounting Intelligence Routes

  IMPORTANT:
  The real calculations live inside:
  backend/services/accountingIntelligenceService.js

  This route exposes the intelligence in smaller sections so the frontend can
  load overview, ledger, audit flags, stock intelligence, SMS intelligence,
  system controls, period review, and expense-funding evidence without
  duplicating business calculations.
*/

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireAccountingAccess(req, res, next) {
  const role = String(req.user?.role || "").toLowerCase();

  if (role === "admin" || role === "manager" || role === "auditor") {
    return next();
  }

  return res.status(403).json({
    status: "error",
    message: "Only admins, managers and auditors can view advanced accounting intelligence.",
  });
}

function safeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function pickFirstObject(...values) {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value;
    }
  }

  return {};
}

function pickFirstArray(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function getGeneratedAt(intelligence) {
  return (
    intelligence?.generated_at ||
    intelligence?.generatedAt ||
    intelligence?.created_at ||
    new Date().toISOString()
  );
}

function buildBaseResponse(message, intelligence, extra = {}) {
  return {
    status: "success",
    message,
    scope: intelligence?.scope || null,
    generated_at: getGeneratedAt(intelligence),
    ...extra,
  };
}

async function attachExpenseFundingEvidence(intelligence) {
  const evidence = await loadExpenseFundingEvidence(intelligence?.scope || {});
  return {
    ...intelligence,
    expense_funding_evidence: evidence,
    expenses: {
      ...safeObject(intelligence?.expenses),
      receipts_funded_expenses: evidence.receipts_funded_expenses,
      externally_funded_expenses: evidence.externally_funded_expenses,
      closing_deductions: evidence.closing_deductions,
      funding_sources: evidence.by_funding_source,
    },
  };
}

function extractLedger(intelligence) {
  return pickFirstObject(
    intelligence?.management_ledger,
    intelligence?.ledger,
    intelligence?.accounting_ledger
  );
}

function extractAudit(intelligence) {
  return pickFirstObject(intelligence?.audit, intelligence?.audit_intelligence);
}

function extractRecommendations(intelligence) {
  return pickFirstArray(
    intelligence?.recommendations,
    intelligence?.audit?.recommendations,
    intelligence?.management_recommendations
  );
}

function extractStockIntelligence(intelligence) {
  return {
    summary: pickFirstObject(
      intelligence?.stock_summary,
      intelligence?.stock?.summary,
      intelligence?.inventory_summary,
      intelligence?.inventory?.summary
    ),
    transfers: pickFirstObject(
      intelligence?.stock_transfers,
      intelligence?.stock?.transfers,
      intelligence?.transfer_intelligence,
      intelligence?.transfers
    ),
    adjustments: pickFirstObject(
      intelligence?.stock_adjustments,
      intelligence?.stock?.adjustments,
      intelligence?.adjustment_intelligence,
      intelligence?.adjustments
    ),
    ledger_sources: pickFirstObject(
      intelligence?.stock_ledger_sources,
      intelligence?.stock?.ledger_sources,
      intelligence?.ledger_sources,
      intelligence?.movement_sources
    ),
    warnings: pickFirstArray(
      intelligence?.stock_warnings,
      intelligence?.stock?.warnings,
      intelligence?.inventory_warnings
    ),
    note:
      "Stock Movement Ledger has no separate table. It is rebuilt from sales, purchases, returns, stock adjustments, and stock transfers.",
  };
}

function extractSmsIntelligence(intelligence) {
  return {
    summary: pickFirstObject(
      intelligence?.sms_summary,
      intelligence?.sms?.summary,
      intelligence?.communication?.sms_summary
    ),
    failed_sms: pickFirstArray(
      intelligence?.failed_sms,
      intelligence?.sms?.failed_sms,
      intelligence?.sms_failures,
      intelligence?.communication?.failed_sms
    ),
    recent_sms: pickFirstArray(
      intelligence?.recent_sms,
      intelligence?.sms?.recent_sms,
      intelligence?.sms_logs,
      intelligence?.communication?.recent_sms
    ),
    warnings: pickFirstArray(
      intelligence?.sms_warnings,
      intelligence?.sms?.warnings,
      intelligence?.communication?.warnings
    ),
  };
}

function extractSystemControls(intelligence) {
  return {
    backup_restore: pickFirstObject(
      intelligence?.backup_restore,
      intelligence?.backups,
      intelligence?.system_controls?.backup_restore,
      intelligence?.system_controls?.backups
    ),
    maintenance: pickFirstObject(
      intelligence?.maintenance,
      intelligence?.system_controls?.maintenance
    ),
    audit_unlocks: pickFirstObject(
      intelligence?.audit_unlocks,
      intelligence?.unlock_requests,
      intelligence?.system_controls?.audit_unlocks
    ),
    audit_signoffs: pickFirstObject(
      intelligence?.audit_signoffs,
      intelligence?.signoffs,
      intelligence?.system_controls?.audit_signoffs
    ),
    reapprovals: pickFirstObject(
      intelligence?.audit_reapprovals,
      intelligence?.reapprovals,
      intelligence?.system_controls?.reapprovals
    ),
  };
}

function extractPeriodReview(intelligence) {
  return pickFirstObject(
    intelligence?.period_review,
    intelligence?.review_summary,
    intelligence?.audit_review_summary,
    intelligence?.period_summary
  );
}

// GET /api/accounting-intelligence/overview
router.get(
  "/overview",
  requireAuth,
  requireAccountingAccess,
  asyncHandler(async (req, res) => {
    const intelligence = await attachExpenseFundingEvidence(
      await buildAccountingIntelligence(req)
    );

    return res.json(
      buildBaseResponse("Advanced accounting and audit intelligence loaded.", intelligence, {
        intelligence,
      })
    );
  })
);

// GET /api/accounting-intelligence/expense-funding
router.get(
  "/expense-funding",
  requireAuth,
  requireAccountingAccess,
  asyncHandler(async (req, res) => {
    const intelligence = await buildAccountingIntelligence(req);
    const evidence = await loadExpenseFundingEvidence(intelligence?.scope || {});

    return res.json(
      buildBaseResponse("Expense funding and Daily Closing evidence loaded.", intelligence, {
        expense_funding_evidence: evidence,
      })
    );
  })
);

// GET /api/accounting-intelligence/ledger
router.get(
  "/ledger",
  requireAuth,
  requireAccountingAccess,
  asyncHandler(async (req, res) => {
    const intelligence = await buildAccountingIntelligence(req);

    return res.json(
      buildBaseResponse("Management ledger loaded.", intelligence, {
        ledger: extractLedger(intelligence),
      })
    );
  })
);

// GET /api/accounting-intelligence/audit-flags
router.get(
  "/audit-flags",
  requireAuth,
  requireAccountingAccess,
  asyncHandler(async (req, res) => {
    const intelligence = await buildAccountingIntelligence(req);

    return res.json(
      buildBaseResponse("Audit intelligence flags loaded.", intelligence, {
        audit: extractAudit(intelligence),
        recommendations: extractRecommendations(intelligence),
      })
    );
  })
);

// GET /api/accounting-intelligence/stock
router.get(
  "/stock",
  requireAuth,
  requireAccountingAccess,
  asyncHandler(async (req, res) => {
    const intelligence = await buildAccountingIntelligence(req);

    return res.json(
      buildBaseResponse("Stock, transfer, adjustment, and ledger-source intelligence loaded.", intelligence, {
        stock: extractStockIntelligence(intelligence),
      })
    );
  })
);

// GET /api/accounting-intelligence/sms
router.get(
  "/sms",
  requireAuth,
  requireAccountingAccess,
  asyncHandler(async (req, res) => {
    const intelligence = await buildAccountingIntelligence(req);

    return res.json(
      buildBaseResponse("SMS communication intelligence loaded.", intelligence, {
        sms: extractSmsIntelligence(intelligence),
      })
    );
  })
);

// GET /api/accounting-intelligence/system-controls
router.get(
  "/system-controls",
  requireAuth,
  requireAccountingAccess,
  asyncHandler(async (req, res) => {
    const intelligence = await buildAccountingIntelligence(req);

    return res.json(
      buildBaseResponse("System control intelligence loaded.", intelligence, {
        system_controls: extractSystemControls(intelligence),
      })
    );
  })
);

// GET /api/accounting-intelligence/review-summary
router.get(
  "/review-summary",
  requireAuth,
  requireAccountingAccess,
  asyncHandler(async (req, res) => {
    const intelligence = await buildAccountingIntelligence(req);

    return res.json(
      buildBaseResponse("Accounting period review summary loaded.", intelligence, {
        review_summary: extractPeriodReview(intelligence),
        stock: extractStockIntelligence(intelligence),
        sms: extractSmsIntelligence(intelligence),
        system_controls: extractSystemControls(intelligence),
        audit: extractAudit(intelligence),
        recommendations: extractRecommendations(intelligence),
      })
    );
  })
);

// GET /api/accounting-intelligence/all
router.get(
  "/all",
  requireAuth,
  requireAccountingAccess,
  asyncHandler(async (req, res) => {
    const intelligence = await attachExpenseFundingEvidence(
      await buildAccountingIntelligence(req)
    );

    return res.json(
      buildBaseResponse("All advanced accounting intelligence loaded.", intelligence, {
        intelligence,
        expense_funding_evidence: intelligence.expense_funding_evidence,
        ledger: extractLedger(intelligence),
        audit: extractAudit(intelligence),
        stock: extractStockIntelligence(intelligence),
        sms: extractSmsIntelligence(intelligence),
        system_controls: extractSystemControls(intelligence),
        review_summary: extractPeriodReview(intelligence),
        recommendations: extractRecommendations(intelligence),
      })
    );
  })
);

module.exports = router;
