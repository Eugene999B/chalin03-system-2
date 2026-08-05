const express = require("express");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");

const router = express.Router();

const REGISTER_ACTION = "EQUIPMENT_FINANCE_MACHINE_REGISTERED";
const REGISTER_ACTION_TYPE = "equipment.finance.machine.register";
const CLEANUP_RECORD =
  "20260805_user_authorized_installment_finance_excavator_cleanup";
const OPERATIONAL_RESET_RECORD =
  "20260805_user_authorized_equipment_installment_restart_reset";

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
       LEFT JOIN schema_migrations cleanup
         ON cleanup.migration_name = ?
       LEFT JOIN schema_migrations operational_reset
         ON operational_reset.migration_name = ?
      WHERE registration.entity_type = 'fleet_asset'
        AND registration.entity_id REGEXP '^[0-9]+$'
        AND asset.is_active = TRUE
        AND (
          registration.action_type = ?
          OR registration.action = ?
        )
        AND (
          registration.workspace_code = 'equipment_installment_finance'
          OR registration.workspace_code IS NULL
        )
        AND (
          (
            cleanup.id IS NOT NULL
            AND registration.created_at >= cleanup.applied_at
          )
          OR (
            cleanup.id IS NULL
            AND operational_reset.id IS NOT NULL
            AND registration.created_at >= operational_reset.applied_at
          )
          OR (
            cleanup.id IS NULL
            AND operational_reset.id IS NULL
          )
        )`,
    [
      CLEANUP_RECORD,
      OPERATIONAL_RESET_RECORD,
      REGISTER_ACTION_TYPE,
      REGISTER_ACTION,
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
          finance_cleanup_cutoff_enabled: true,
          finance_operational_reset_fallback_enabled: true,
          finance_visibility_ready: visibilityReady,
          non_finance_excavators_hidden: Math.max(0, sourceCount - machines.length),
        },
      });
    };

    return next();
  }
);

module.exports = router;
module.exports.CLEANUP_RECORD = CLEANUP_RECORD;
module.exports.OPERATIONAL_RESET_RECORD = OPERATIONAL_RESET_RECORD;
module.exports.loadVisibleFinanceAssetIds = loadVisibleFinanceAssetIds;
module.exports.REGISTER_ACTION = REGISTER_ACTION;
module.exports.REGISTER_ACTION_TYPE = REGISTER_ACTION_TYPE;
