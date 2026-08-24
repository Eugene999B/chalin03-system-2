"use strict";

const express = require("express");
const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const candidateRoutes = require("../routes/equipmentFinanceOpeningDepositCandidateCompatibilityRoutes");
const financeDepositRoutes = require("../routes/equipmentFinanceDepositReservationRoutes");

if (!candidateRoutes.__chalin03CanonicalCandidatesInstalled) {
  const canonicalRouter = express.Router();

  canonicalRouter.get(
    "/deposit-reservations/candidates",
    requirePermission("fleet.assets.view"),
    async (_req, res) => {
      const connection = await pool.getConnection();
      try {
        const readiness = await financeDepositRoutes.schemaStatus(connection);
        if (!readiness.ready) {
          return res.status(503).json({
            status: "error",
            code: "EQUIPMENT_FINANCE_DEPOSIT_FOUNDATION_REQUIRED",
            message: "Finance deposit and reservation controls are not ready.",
            readiness,
          });
        }

        const candidates = await candidateRoutes.listCandidates(connection);
        return res.json({
          status: "success",
          candidates,
          scope: "company_wide",
          hire_location_selection_required: false,
          compatibility_mode: true,
          safeguards: {
            hire_work_created: false,
            delivery_created: false,
            ownership_transferred: false,
            sms_sent: false,
          },
        });
      } catch (error) {
        console.error("Canonical Finance deposit candidates query failed.", {
          code: String(error?.code || "").slice(0, 80),
          errno: Number(error?.errno || 0) || null,
        });
        const status = Number(error?.statusCode || 500);
        return res.status(status >= 500 ? status : 500).json({
          status: "error",
          code: error?.code || "EQUIPMENT_FINANCE_DEPOSIT_CANDIDATE_QUERY_FAILED",
          message:
            error?.code === "ER_NO_SUCH_TABLE" || error?.code === "ER_BAD_FIELD_ERROR"
              ? "Finance deposit agreements could not be loaded because a required production field is unavailable."
              : "Could not load Finance deposit agreements.",
        });
      } finally {
        connection.release();
      }
    }
  );

  candidateRoutes.stack.unshift(...canonicalRouter.stack);

  Object.defineProperty(candidateRoutes, "__chalin03CanonicalCandidatesInstalled", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}
