"use strict";

const { normalizeAiPersona } = require("../security/aiPermissionCatalog");
const {
  hasEquipmentDivisionAccess,
} = require("../security/equipmentDivisionAccess");
const { resolveAiScope } = require("./aiPermissionService");

const CONTEXT_KEY_PATTERN = /^[a-z][a-z0-9_.-]{2,79}$/;

const CONTEXT_PROFILES = Object.freeze({
  "spare_parts.operations": Object.freeze({
    key: "spare_parts.operations",
    title: "Spare Parts operations",
    workspace_code: "spare_parts",
    classification: "internal",
    preload_tool: "spare_parts.operations_snapshot",
    purpose:
      "Current branch sales, collections, inventory, purchasing, returns, expenses and audit health.",
  }),
  "spare_parts.inventory": Object.freeze({
    key: "spare_parts.inventory",
    title: "Spare Parts inventory",
    workspace_code: "spare_parts",
    classification: "internal",
    preload_tool: "spare_parts.inventory_health",
    purpose:
      "Current branch stock value, low or negative stock and inventory-control signals.",
  }),
  "spare_parts.collections": Object.freeze({
    key: "spare_parts.collections",
    title: "Spare Parts collections",
    workspace_code: "spare_parts",
    classification: "internal",
    preload_tool: "spare_parts.collections_health",
    purpose:
      "Current branch aggregate debt aging, collections and collection-rate health without customer rows.",
  }),
  "mining.operations": Object.freeze({
    key: "mining.operations",
    title: "Mining operations",
    workspace_code: "mining",
    classification: "internal",
    preload_tool: "mining.operations_snapshot",
    purpose:
      "Current selected-site production, dispatch, stockpile, fuel, crew, closing, equipment, cost and incident health.",
  }),
  "mining.stock_fuel": Object.freeze({
    key: "mining.stock_fuel",
    title: "Mining stockpile and fuel",
    workspace_code: "mining",
    classification: "internal",
    preload_tool: "mining.stock_fuel_health",
    purpose:
      "Current selected-site stockpile and fuel health with low-level signals.",
  }),
  "mining.production_cost": Object.freeze({
    key: "mining.production_cost",
    title: "Mining production and cost",
    workspace_code: "mining",
    classification: "internal",
    preload_tool: "mining.production_cost_health",
    purpose:
      "Current selected-site production, cost-per-unit, equipment utilization and incident health.",
  }),
  "equipment_hire.operations": Object.freeze({
    key: "equipment_hire.operations",
    title: "Equipment Hire operations",
    workspace_code: "equipment_hire",
    equipment_division: "hire",
    classification: "internal",
    preload_tool: "equipment_hire.operations_snapshot",
    purpose:
      "Current selected-location enquiries, quotations, contracts, fleet, work, receivables, returns and closure health.",
  }),
  "equipment_hire.fleet": Object.freeze({
    key: "equipment_hire.fleet",
    title: "Equipment Hire fleet",
    workspace_code: "equipment_hire",
    equipment_division: "hire",
    classification: "internal",
    preload_tool: "equipment_hire.fleet_health",
    purpose:
      "Current selected-location fleet availability, utilization, maintenance, breakdown and return health.",
  }),
  "equipment_hire.receivables": Object.freeze({
    key: "equipment_hire.receivables",
    title: "Equipment Hire receivables",
    workspace_code: "equipment_hire",
    equipment_division: "hire",
    classification: "internal",
    preload_tool: "equipment_hire.receivables_health",
    purpose:
      "Current selected-location invoices, collections, outstanding and overdue receivables health.",
  }),
  "equipment_finance.portfolio": Object.freeze({
    key: "equipment_finance.portfolio",
    title: "Installment Finance portfolio",
    workspace_code: "equipment_hire",
    equipment_division: "finance",
    classification: "confidential",
    preload_tool: "equipment_finance.portfolio_health",
    purpose:
      "Company-wide aggregate installment portfolio, collections, balances, reconciliation and application-pipeline health without customer rows.",
  }),
  "equipment_finance.arrears": Object.freeze({
    key: "equipment_finance.arrears",
    title: "Installment Finance arrears",
    workspace_code: "equipment_hire",
    equipment_division: "finance",
    classification: "confidential",
    preload_tool: "equipment_finance.arrears_health",
    purpose:
      "Company-wide aggregate overdue accounts, balances and arrears aging without customer identities.",
  }),
  "equipment_finance.cashflow": Object.freeze({
    key: "equipment_finance.cashflow",
    title: "Installment Finance cash flow",
    workspace_code: "equipment_hire",
    equipment_division: "finance",
    classification: "confidential",
    preload_tool: "equipment_finance.cashflow_health",
    purpose:
      "Company-wide aggregate collections, scheduled expectations, monthly trends and payment-method health.",
  }),
  "equipment_finance.sales_pipeline": Object.freeze({
    key: "equipment_finance.sales_pipeline",
    title: "Equipment sales and Finance pipeline",
    workspace_code: "equipment_hire",
    equipment_division: "finance",
    classification: "confidential",
    preload_tool: "equipment_finance.sales_pipeline",
    purpose:
      "Aggregate sale-capable equipment and credit-application, KYC, affordability and risk pipeline health without applicant identities.",
  }),
});

class AiContextProfileError extends Error {
  constructor(message, { code = "AI_CONTEXT_PROFILE_INVALID", statusCode = 400, details = [] } = {}) {
    super(message);
    this.name = "AiContextProfileError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function cleanContextKey(value) {
  const key = String(value || "").trim().toLowerCase();
  return CONTEXT_KEY_PATTERN.test(key) ? key : null;
}

function getContextProfile(contextKey) {
  const key = cleanContextKey(contextKey);
  const profile = key ? CONTEXT_PROFILES[key] : null;
  if (!profile) {
    throw new AiContextProfileError("Unknown CHALIN contextual intelligence profile.", {
      code: "AI_CONTEXT_PROFILE_NOT_FOUND",
      statusCode: 404,
      details: key ? [key] : [],
    });
  }
  return profile;
}

function resolveContextProfile({ contextKey, req, persona = "copilot" } = {}) {
  const normalizedPersona = normalizeAiPersona(persona);
  if (!["copilot", "executive"].includes(normalizedPersona)) {
    throw new AiContextProfileError(
      "Contextual workspace intelligence supports Copilot or Executive only.",
      { code: "AI_CONTEXT_PERSONA_INVALID" }
    );
  }

  const profile = getContextProfile(contextKey);
  const scope = resolveAiScope({ req, persona: normalizedPersona });
  if (scope.workspace_code !== profile.workspace_code) {
    throw new AiContextProfileError(
      "This contextual intelligence profile belongs to a different workspace.",
      {
        code: "AI_CONTEXT_WORKSPACE_MISMATCH",
        statusCode: 403,
        details: [profile.workspace_code],
      }
    );
  }
  if (
    profile.equipment_division &&
    !hasEquipmentDivisionAccess(req.user, profile.equipment_division)
  ) {
    throw new AiContextProfileError(
      "This contextual intelligence profile belongs to a different Equipment division.",
      {
        code: "AI_CONTEXT_EQUIPMENT_DIVISION_DENIED",
        statusCode: 403,
        details: [profile.equipment_division],
      }
    );
  }

  return Object.freeze({
    ...profile,
    persona: normalizedPersona,
    scope: Object.freeze({
      workspace_code: scope.workspace_code,
      branch_id: scope.branch_id,
      mining_site_id: scope.mining_site_id,
      hire_location_id: scope.hire_location_id,
    }),
  });
}

function publicContextProfiles() {
  return Object.freeze(
    Object.values(CONTEXT_PROFILES).map((profile) =>
      Object.freeze({
        key: profile.key,
        title: profile.title,
        workspace_code: profile.workspace_code,
        equipment_division: profile.equipment_division || null,
        classification: profile.classification,
        purpose: profile.purpose,
      })
    )
  );
}

module.exports = {
  AiContextProfileError,
  CONTEXT_KEY_PATTERN,
  CONTEXT_PROFILES,
  cleanContextKey,
  getContextProfile,
  publicContextProfiles,
  resolveContextProfile,
};
