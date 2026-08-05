const express = require("express");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");

const router = express.Router();

const REGISTER_ACTION = "EQUIPMENT_FINANCE_MACHINE_REGISTERED";
const REGISTER_ACTION_TYPE = "equipment.finance.machine.register";
const HIDDEN_ACTION = "EQUIPMENT_FINANCE_MACHINE_RESET_HIDDEN";
const HIDDEN_ACTION_TYPE = "equipment.finance.machine.reset_hidden";

function numericId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

async function loadVisibleFinanceAssetIds(connection = pool) {
  const [rows] = await connection.query(
    `SELECT DISTINCT CAST(registration.entity_id AS UNSIGNED) AS asset_id
       FROM activity_log registration
       INNER JOIN fleet_assets asset
         ON asset.id = CAST(registration.entity_id AS UNSIGNED)
      WHERE registration.entity_type = 'fleet_asset'
        AND registration.entity_id REGEXP '^[0-9]+$'
        AND (
          registration.action_type = ?
          OR registration.action = ?
        )
        AND (
          registration.workspace_code = 'equipment_installment_finance'
          OR registration.workspace_code IS NULL
        )
        AND NOT EXISTS (
          SELECT 1
            FROM activity_log hidden
           WHERE hidden.entity_type = 'fleet_asset'
             AND hidden.entity_id = registration.entity_id
             AND (
               hidden.action_type = ?
               OR hidden.action = ?
             )
        )`,
    [
      REGISTER_ACTION_TYPE,
      REGISTER_ACTION,
      HIDDEN_ACTION_TYPE,
      HIDDEN_ACTION,
    ]
  );

  return new Set(rows.map((row) => numericId(row.asset_id)).filter(Boolean));
}

router.get(
  "/phase-one/bootstrap",
  requirePermission("fleet.assets.view"),
  async (_req, res, next) => {
    let visibleIds = new Set();
    let visibilityReady = true;
    try {
      visibleIds = await loadVisibleFinanceAssetIds();
    } catch (error) {
      visibilityReady = false;
      console.error("Finance excavator visibility filter failed closed:", error);
    }

    const sendJson = res.json.bind(res);
    res.json = (payload) => {
      if (!payload || !Array.isArray(payload.machines)) {
        return sendJson(payload);
      }

      const sourceCount = payload.machines.length;
      const machines = payload.machines.filter((machine) =>
        visibleIds.has(numericId(machine?.id))
      );

      return sendJson({
        ...payload,
        machines,
        policy: {
          ...(payload.policy || {}),
          finance_registered_excavators_only: true,
          finance_visibility_ready: visibilityReady,
          non_finance_excavators_hidden: Math.max(0, sourceCount - machines.length),
        },
      });
    };

    return next();
  }
);

module.exports = router;
module.exports.loadVisibleFinanceAssetIds = loadVisibleFinanceAssetIds;
module.exports.REGISTER_ACTION = REGISTER_ACTION;
module.exports.REGISTER_ACTION_TYPE = REGISTER_ACTION_TYPE;
module.exports.HIDDEN_ACTION = HIDDEN_ACTION;
module.exports.HIDDEN_ACTION_TYPE = HIDDEN_ACTION_TYPE;
