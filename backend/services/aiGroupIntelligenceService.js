"use strict";

const { pool } = require("../config/db");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const {
  buildOperationsSnapshot: buildSparePartsOperationsSnapshot,
  loadSparePartsIntelligence,
} = require("./aiSparePartsIntelligenceService");
const {
  buildOperationsSnapshot: buildMiningOperationsSnapshot,
  loadMiningIntelligence,
} = require("./aiMiningIntelligenceService");
const {
  buildOperationsSnapshot: buildHireOperationsSnapshot,
  loadHireIntelligence,
} = require("./aiHireIntelligenceService");
const {
  loadPortfolioHealth,
} = require("./aiEquipmentFinanceIntelligenceService");

const MAX_BRANCHES = 20;
const MAX_MINING_SITES = 30;
const MAX_HIRE_LOCATIONS = 20;

function groupError(message, code = "AI_GROUP_INTELLIGENCE_FAILED", statusCode = 500) {
  const error = new Error(message);
  error.name = "AiGroupIntelligenceError";
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function assertSystemAdministrator(context) {
  if (!isOriginalSystemAdministrator(context?.actor || {})) {
    throw groupError(
      "Whole-system CHALIN intelligence is restricted to the original System Administrator.",
      "AI_GROUP_INTELLIGENCE_SYSTEM_ADMIN_REQUIRED",
      403
    );
  }
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, decimals = 2) {
  return Number(number(value).toFixed(decimals));
}

function errorSummary(error) {
  return Object.freeze({
    code: String(error?.code || error?.name || "UNAVAILABLE").slice(0, 120),
    message: String(error?.message || "This intelligence area is unavailable.").slice(0, 300),
  });
}

async function scopeDirectory(connection = pool) {
  const [[branches], [miningSites], [hireLocations]] = await Promise.all([
    connection.query(
      `SELECT id, COALESCE(NULLIF(code, ''), branch_code) AS code, name
       FROM branches
       WHERE is_active = TRUE
       ORDER BY id ASC
       LIMIT ?`,
      [MAX_BRANCHES]
    ),
    connection.query(
      `SELECT id, site_code AS code, site_name AS name
       FROM mining_sites
       WHERE is_active = TRUE AND status = 'active'
       ORDER BY id ASC
       LIMIT ?`,
      [MAX_MINING_SITES]
    ),
    connection.query(
      `SELECT bl.id, bl.code, bl.name
       FROM business_locations bl
       INNER JOIN business_units bu ON bu.id = bl.business_unit_id
       WHERE bl.is_active = TRUE
         AND bu.code = 'equipment_hire'
         AND bu.is_enabled = TRUE
       ORDER BY bl.id ASC
       LIMIT ?`,
      [MAX_HIRE_LOCATIONS]
    ),
  ]);

  return Object.freeze({
    branches: Object.freeze(branches),
    mining_sites: Object.freeze(miningSites),
    hire_locations: Object.freeze(hireLocations),
  });
}

function syntheticContext(context, scope) {
  return Object.freeze({
    actor: Object.freeze({
      id: Number(context.actor.id),
      username: String(context.actor.username || ""),
      role: String(context.actor.role || "admin"),
      workspace_role: String(context.actor.workspace_role || context.actor.role || "admin"),
    }),
    scope: Object.freeze({
      persona: context.scope?.persona || "copilot",
      user_id: Number(context.actor.id),
      workspace_code: scope.workspace_code,
      branch_id: scope.branch_id || null,
      mining_site_id: scope.mining_site_id || null,
      hire_location_id: scope.hire_location_id || null,
    }),
  });
}

async function loadSparePartsGroup({ directory, context, input }) {
  const rows = await Promise.all(
    directory.branches.map(async (branch) => {
      try {
        const scoped = syntheticContext(context, {
          workspace_code: "spare_parts",
          branch_id: Number(branch.id),
        });
        const loaded = await loadSparePartsIntelligence({ context: scoped, input });
        const snapshot = buildSparePartsOperationsSnapshot(loaded.intelligence, scoped);
        return Object.freeze({
          available: true,
          branch: Object.freeze({ id: Number(branch.id), code: branch.code, name: branch.name }),
          snapshot,
        });
      } catch (error) {
        return Object.freeze({
          available: false,
          branch: Object.freeze({ id: Number(branch.id), code: branch.code, name: branch.name }),
          error: errorSummary(error),
        });
      }
    })
  );

  const successful = rows.filter((row) => row.available);
  return Object.freeze({
    scope_count: rows.length,
    available_count: successful.length,
    totals: Object.freeze({
      sales: round(successful.reduce((sum, row) => sum + number(row.snapshot?.sales?.total_sales), 0)),
      paid: round(successful.reduce((sum, row) => sum + number(row.snapshot?.sales?.total_paid), 0)),
      sales_balance: round(successful.reduce((sum, row) => sum + number(row.snapshot?.sales?.total_balance), 0)),
      debt_balance: round(successful.reduce((sum, row) => sum + number(row.snapshot?.collections?.total_debt_balance), 0)),
      low_stock_items: successful.reduce((sum, row) => sum + number(row.snapshot?.inventory?.low_stock_count), 0),
      negative_stock_items: successful.reduce((sum, row) => sum + number(row.snapshot?.inventory?.negative_stock_count), 0),
    }),
    branches: Object.freeze(rows),
  });
}

async function loadMiningGroup({ directory, context, input }) {
  const rows = await Promise.all(
    directory.mining_sites.map(async (site) => {
      try {
        const scoped = syntheticContext(context, {
          workspace_code: "mining",
          mining_site_id: Number(site.id),
        });
        const intelligence = await loadMiningIntelligence({ context: scoped, input });
        return Object.freeze({
          available: true,
          site: Object.freeze({ id: Number(site.id), code: site.code, name: site.name }),
          snapshot: buildMiningOperationsSnapshot(intelligence),
        });
      } catch (error) {
        return Object.freeze({
          available: false,
          site: Object.freeze({ id: Number(site.id), code: site.code, name: site.name }),
          error: errorSummary(error),
        });
      }
    })
  );

  const successful = rows.filter((row) => row.available);
  return Object.freeze({
    scope_count: rows.length,
    available_count: successful.length,
    totals: Object.freeze({
      production_quantity: round(successful.reduce((sum, row) => sum + number(row.snapshot?.summary?.production_quantity), 0), 3),
      operating_cost: round(successful.reduce((sum, row) => sum + number(row.snapshot?.summary?.operating_cost), 0)),
      serious_incidents: successful.reduce((sum, row) => sum + number(row.snapshot?.summary?.serious_incidents), 0),
      low_stockpiles: successful.reduce((sum, row) => sum + number(row.snapshot?.summary?.low_stockpiles), 0),
      low_fuel_tanks: successful.reduce((sum, row) => sum + number(row.snapshot?.summary?.low_tanks), 0),
    }),
    sites: Object.freeze(rows),
  });
}

async function loadHireGroup({ directory, context }) {
  const rows = await Promise.all(
    directory.hire_locations.map(async (location) => {
      try {
        const scoped = syntheticContext(context, {
          workspace_code: "equipment_hire",
          hire_location_id: Number(location.id),
        });
        const intelligence = await loadHireIntelligence({ context: scoped });
        return Object.freeze({
          available: true,
          location: Object.freeze({ id: Number(location.id), code: location.code, name: location.name }),
          snapshot: buildHireOperationsSnapshot(intelligence),
        });
      } catch (error) {
        return Object.freeze({
          available: false,
          location: Object.freeze({ id: Number(location.id), code: location.code, name: location.name }),
          error: errorSummary(error),
        });
      }
    })
  );

  const successful = rows.filter((row) => row.available);
  return Object.freeze({
    scope_count: rows.length,
    available_count: successful.length,
    totals: Object.freeze({
      fleet_assets: successful.reduce((sum, row) => sum + number(row.snapshot?.fleet?.total_assets), 0),
      assets_on_hire: successful.reduce((sum, row) => sum + number(row.snapshot?.fleet?.assets_on_hire), 0),
      active_contracts: successful.reduce((sum, row) => sum + number(row.snapshot?.pipeline?.active_contracts), 0),
      invoiced_amount: round(successful.reduce((sum, row) => sum + number(row.snapshot?.receivables?.invoiced_amount), 0)),
      outstanding_amount: round(successful.reduce((sum, row) => sum + number(row.snapshot?.receivables?.outstanding_amount), 0)),
      overdue_amount: round(successful.reduce((sum, row) => sum + number(row.snapshot?.receivables?.overdue_amount), 0)),
    }),
    locations: Object.freeze(rows),
  });
}

async function loadFinanceGroup({ input }) {
  try {
    return Object.freeze({
      available: true,
      snapshot: await loadPortfolioHealth({ input }),
    });
  } catch (error) {
    return Object.freeze({ available: false, error: errorSummary(error) });
  }
}

async function loadGroupIntelligence({ context, input = {}, connection = pool } = {}) {
  assertSystemAdministrator(context);

  let directory;
  try {
    directory = await scopeDirectory(connection);
  } catch (error) {
    throw groupError(
      "CHALIN could not load the authorized group scope directory.",
      "AI_GROUP_SCOPE_DIRECTORY_FAILED",
      503
    );
  }

  const [spareParts, mining, equipmentHire, equipmentFinance] = await Promise.all([
    loadSparePartsGroup({ directory, context, input }),
    loadMiningGroup({ directory, context, input }),
    loadHireGroup({ directory, context }),
    loadFinanceGroup({ input }),
  ]);

  return Object.freeze({
    scope: "system_administrator_group_aggregate",
    generated_at: new Date().toISOString(),
    spare_parts: spareParts,
    mining,
    equipment_hire: equipmentHire,
    equipment_finance: equipmentFinance,
    privacy: Object.freeze({
      aggregate_only: true,
      customer_identity_included: false,
      worker_identity_included: false,
      applicant_identity_included: false,
      phone_numbers_included: false,
      raw_transaction_rows_included: false,
      direct_database_access_exposed_to_model: false,
    }),
    execution_authority: "read_only",
  });
}

module.exports = {
  MAX_BRANCHES,
  MAX_HIRE_LOCATIONS,
  MAX_MINING_SITES,
  assertSystemAdministrator,
  loadGroupIntelligence,
  scopeDirectory,
  syntheticContext,
};
