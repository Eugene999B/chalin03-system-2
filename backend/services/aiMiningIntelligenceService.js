"use strict";

const { pool } = require("../config/db");

function asNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function round(value, decimals = 2) {
  return Number(asNumber(value).toFixed(decimals));
}

function cleanDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : text;
}

function defaultDateRange() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

function normalizeDateRange(input = {}) {
  const defaults = defaultDateRange();
  let from = cleanDate(input.start_date || input.from) || defaults.from;
  let to = cleanDate(input.end_date || input.to) || defaults.to;
  if (from > to) [from, to] = [to, from];
  return { from, to };
}

function miningError(message, code = "AI_MINING_INTELLIGENCE_FAILED", statusCode = 500) {
  const error = new Error(message);
  error.name = "AiMiningIntelligenceError";
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function buildAlerts(summary) {
  const alerts = [];
  function add(severity, key, message) {
    alerts.push({ severity, key, message });
  }

  if (Number(summary.low_stockpiles || 0) > 0) {
    add("warning", "low_stockpiles", `${summary.low_stockpiles} active stockpile(s) are at or below minimum quantity.`);
  }
  if (Number(summary.low_tanks || 0) > 0) {
    add("warning", "low_fuel_tanks", `${summary.low_tanks} active fuel tank(s) are at or below minimum level.`);
  }
  if (Number(summary.pending_dispatches || 0) > 0) {
    add("review", "pending_dispatches", `${summary.pending_dispatches} dispatch(es) are waiting for approval.`);
  }
  if (Number(summary.pending_closings || 0) > 0) {
    add("review", "pending_closings", `${summary.pending_closings} site closing(s) are waiting for review.`);
  }
  if (Number(summary.serious_incidents || 0) > 0) {
    add("danger", "serious_incidents", `${summary.serious_incidents} high/critical incident(s) remain open.`);
  }
  if (Number(summary.breakdown_hours || 0) > Number(summary.working_hours || 0) && Number(summary.breakdown_hours || 0) > 0) {
    add("danger", "breakdown_hours", "Breakdown hours exceed working hours in the selected period.");
  }
  if (summary.utilization_percent != null && Number(summary.utilization_percent) < 60) {
    add("warning", "low_utilization", `Equipment utilization is ${summary.utilization_percent}%.`);
  }
  return alerts;
}

async function loadMiningIntelligence({ context, input = {}, connection = pool } = {}) {
  const siteId = Number(context?.scope?.mining_site_id || 0);
  if (!Number.isInteger(siteId) || siteId <= 0) {
    throw miningError("Choose an authorized Mining site before requesting Mining intelligence.", "AI_MINING_SITE_SCOPE_REQUIRED", 409);
  }

  const { from, to } = normalizeDateRange(input);

  try {
    const [
      [siteRows],
      [stockpileRows],
      [dispatchRows],
      [fuelRows],
      [crewRows],
      [closingRows],
      [productionRows],
      [expenseRows],
      [equipmentRows],
      [incidentRows],
      [lowStockpileRows],
      [lowTankRows],
    ] = await Promise.all([
      connection.query(
        `SELECT id, site_code, site_name, location, material_type, production_unit, daily_target
         FROM mining_sites
         WHERE id = ? AND is_active = TRUE AND status = 'active'
         LIMIT 1`,
        [siteId]
      ),
      connection.query(
        `SELECT COUNT(*) AS stockpile_count,
                COALESCE(SUM(current_quantity), 0) AS stockpile_quantity,
                COALESCE(SUM(CASE WHEN current_quantity <= minimum_quantity THEN 1 ELSE 0 END), 0) AS low_stockpiles
         FROM mining_stockpiles
         WHERE site_id = ? AND status = 'active'`,
        [siteId]
      ),
      connection.query(
        `SELECT COUNT(*) AS dispatch_count,
                COALESCE(SUM(CASE WHEN status = 'approved' THEN quantity ELSE 0 END), 0) AS dispatched_quantity,
                COALESCE(SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END), 0) AS pending_dispatches
         FROM mining_dispatches
         WHERE site_id = ? AND DATE(dispatch_datetime) BETWEEN ? AND ?`,
        [siteId, from, to]
      ),
      connection.query(
        `SELECT COUNT(*) AS tank_count,
                COALESCE(SUM(current_balance_litres), 0) AS fuel_balance_litres,
                COALESCE(SUM(CASE WHEN current_balance_litres <= minimum_level_litres THEN 1 ELSE 0 END), 0) AS low_tanks
         FROM mining_fuel_tanks
         WHERE site_id = ? AND status = 'active'`,
        [siteId]
      ),
      connection.query(
        `SELECT COUNT(*) AS crew_count,
                COALESCE(SUM(actual_headcount), 0) AS crew_headcount,
                COALESCE(SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END), 0) AS pending_crews
         FROM mining_shift_crews
         WHERE site_id = ? AND shift_date BETWEEN ? AND ?`,
        [siteId, from, to]
      ),
      connection.query(
        `SELECT COUNT(*) AS closing_count,
                COALESCE(SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END), 0) AS pending_closings
         FROM mining_site_closings
         WHERE site_id = ? AND period_end BETWEEN ? AND ?`,
        [siteId, from, to]
      ),
      connection.query(
        `SELECT COALESCE(SUM(quantity), 0) AS production_quantity
         FROM mining_production_records
         WHERE site_id = ? AND DATE(production_datetime) BETWEEN ? AND ?`,
        [siteId, from, to]
      ),
      connection.query(
        `SELECT COALESCE(SUM(amount), 0) AS operating_cost
         FROM mining_expenses
         WHERE site_id = ? AND expense_date BETWEEN ? AND ?`,
        [siteId, from, to]
      ),
      connection.query(
        `SELECT COALESCE(SUM(working_hours), 0) AS working_hours,
                COALESCE(SUM(idle_hours), 0) AS idle_hours,
                COALESCE(SUM(breakdown_hours), 0) AS breakdown_hours
         FROM mining_equipment_logs
         WHERE site_id = ? AND work_date BETWEEN ? AND ?`,
        [siteId, from, to]
      ),
      connection.query(
        `SELECT COALESCE(SUM(CASE WHEN status IN ('open', 'investigating') THEN 1 ELSE 0 END), 0) AS open_incidents,
                COALESCE(SUM(CASE WHEN severity IN ('high', 'critical') AND status <> 'closed' THEN 1 ELSE 0 END), 0) AS serious_incidents
         FROM mining_incidents
         WHERE site_id = ?`,
        [siteId]
      ),
      connection.query(
        `SELECT id, stockpile_code, stockpile_name, material_type, unit,
                current_quantity, minimum_quantity, capacity_quantity
         FROM mining_stockpiles
         WHERE site_id = ? AND status = 'active'
           AND current_quantity <= minimum_quantity
         ORDER BY current_quantity ASC, stockpile_name ASC
         LIMIT 15`,
        [siteId]
      ),
      connection.query(
        `SELECT id, tank_code, tank_name, current_balance_litres,
                minimum_level_litres, capacity_litres
         FROM mining_fuel_tanks
         WHERE site_id = ? AND status = 'active'
           AND current_balance_litres <= minimum_level_litres
         ORDER BY current_balance_litres ASC, tank_name ASC
         LIMIT 15`,
        [siteId]
      ),
    ]);

    const site = siteRows[0];
    if (!site) {
      throw miningError("The selected Mining site is unavailable.", "AI_MINING_SITE_NOT_FOUND", 404);
    }

    const summary = {
      ...(stockpileRows[0] || {}),
      ...(dispatchRows[0] || {}),
      ...(fuelRows[0] || {}),
      ...(crewRows[0] || {}),
      ...(closingRows[0] || {}),
      ...(productionRows[0] || {}),
      ...(expenseRows[0] || {}),
      ...(equipmentRows[0] || {}),
      ...(incidentRows[0] || {}),
    };

    const production = asNumber(summary.production_quantity);
    const operatingCost = asNumber(summary.operating_cost);
    const working = asNumber(summary.working_hours);
    const idle = asNumber(summary.idle_hours);
    const breakdown = asNumber(summary.breakdown_hours);
    const totalTrackedHours = working + idle + breakdown;

    const normalizedSummary = {
      stockpile_count: Number(summary.stockpile_count || 0),
      stockpile_quantity: round(summary.stockpile_quantity, 3),
      low_stockpiles: Number(summary.low_stockpiles || 0),
      dispatch_count: Number(summary.dispatch_count || 0),
      dispatched_quantity: round(summary.dispatched_quantity, 3),
      pending_dispatches: Number(summary.pending_dispatches || 0),
      tank_count: Number(summary.tank_count || 0),
      fuel_balance_litres: round(summary.fuel_balance_litres, 2),
      low_tanks: Number(summary.low_tanks || 0),
      crew_count: Number(summary.crew_count || 0),
      crew_headcount: Number(summary.crew_headcount || 0),
      pending_crews: Number(summary.pending_crews || 0),
      closing_count: Number(summary.closing_count || 0),
      pending_closings: Number(summary.pending_closings || 0),
      production_quantity: round(production, 3),
      operating_cost: round(operatingCost, 2),
      working_hours: round(working, 2),
      idle_hours: round(idle, 2),
      breakdown_hours: round(breakdown, 2),
      open_incidents: Number(summary.open_incidents || 0),
      serious_incidents: Number(summary.serious_incidents || 0),
      cost_per_unit: production > 0 ? round(operatingCost / production, 2) : null,
      utilization_percent: totalTrackedHours > 0 ? round((working / totalTrackedHours) * 100, 2) : null,
    };

    return Object.freeze({
      scope: Object.freeze({
        workspace_code: "mining",
        mining_site_id: siteId,
        site_code: site.site_code || null,
        site_name: site.site_name || null,
        location: site.location || null,
        material_type: site.material_type || null,
        production_unit: site.production_unit || null,
        daily_target: site.daily_target == null ? null : round(site.daily_target, 3),
        start_date: from,
        end_date: to,
      }),
      summary: Object.freeze(normalizedSummary),
      low_stockpiles: Object.freeze(lowStockpileRows.map((row) => Object.freeze({
        stockpile_id: Number(row.id),
        code: row.stockpile_code,
        name: row.stockpile_name,
        material_type: row.material_type || null,
        unit: row.unit || site.production_unit || null,
        current_quantity: round(row.current_quantity, 3),
        minimum_quantity: round(row.minimum_quantity, 3),
        capacity_quantity: row.capacity_quantity == null ? null : round(row.capacity_quantity, 3),
      }))),
      low_fuel_tanks: Object.freeze(lowTankRows.map((row) => Object.freeze({
        tank_id: Number(row.id),
        code: row.tank_code,
        name: row.tank_name,
        current_balance_litres: round(row.current_balance_litres, 2),
        minimum_level_litres: round(row.minimum_level_litres, 2),
        capacity_litres: row.capacity_litres == null ? null : round(row.capacity_litres, 2),
      }))),
      alerts: Object.freeze(buildAlerts(normalizedSummary)),
      generated_at: new Date().toISOString(),
      execution_authority: "read_only",
    });
  } catch (error) {
    if (String(error?.code || "").startsWith("AI_")) throw error;
    throw miningError("Mining intelligence could not be loaded safely.");
  }
}

function buildOperationsSnapshot(intelligence) {
  return {
    scope: intelligence.scope,
    summary: intelligence.summary,
    alerts: intelligence.alerts,
    generated_at: intelligence.generated_at,
  };
}

function buildStockFuelHealth(intelligence) {
  return {
    scope: intelligence.scope,
    stock: {
      stockpile_count: intelligence.summary.stockpile_count,
      stockpile_quantity: intelligence.summary.stockpile_quantity,
      low_stockpiles: intelligence.summary.low_stockpiles,
      items: intelligence.low_stockpiles,
    },
    fuel: {
      tank_count: intelligence.summary.tank_count,
      fuel_balance_litres: intelligence.summary.fuel_balance_litres,
      low_tanks: intelligence.summary.low_tanks,
      tanks: intelligence.low_fuel_tanks,
    },
    alerts: intelligence.alerts.filter((item) => ["low_stockpiles", "low_fuel_tanks"].includes(item.key)),
    generated_at: intelligence.generated_at,
  };
}

function buildProductionCostHealth(intelligence) {
  const s = intelligence.summary;
  return {
    scope: intelligence.scope,
    production: {
      quantity: s.production_quantity,
      dispatched_quantity: s.dispatched_quantity,
      pending_dispatches: s.pending_dispatches,
      operating_cost: s.operating_cost,
      cost_per_unit: s.cost_per_unit,
    },
    equipment: {
      working_hours: s.working_hours,
      idle_hours: s.idle_hours,
      breakdown_hours: s.breakdown_hours,
      utilization_percent: s.utilization_percent,
    },
    controls: {
      open_incidents: s.open_incidents,
      serious_incidents: s.serious_incidents,
      pending_closings: s.pending_closings,
      pending_crews: s.pending_crews,
    },
    alerts: intelligence.alerts,
    generated_at: intelligence.generated_at,
  };
}

module.exports = {
  buildOperationsSnapshot,
  buildProductionCostHealth,
  buildStockFuelHealth,
  loadMiningIntelligence,
  normalizeDateRange,
};