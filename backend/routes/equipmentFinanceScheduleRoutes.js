const express = require("express");

const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  buildFinanceSchedule,
  FinanceScheduleError,
} = require("../services/equipmentFinanceScheduleService");

const router = express.Router();

router.post(
  "/phase-one/schedule-preview",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const schedule = buildFinanceSchedule(req.body?.offer || req.body || {});
      return res.json({
        status: "success",
        message:
          "Exact installment dates calculated. No application, agreement or payment record was changed.",
        schedule,
        safeguards: {
          read_only: true,
          creates_application: false,
          creates_agreement: false,
          records_payment: false,
          reserves_equipment: false,
          changes_hire_records: false,
        },
      });
    } catch (error) {
      if (error instanceof FinanceScheduleError) {
        return res.status(Number(error.statusCode || 400)).json({
          status: "error",
          code: error.code,
          message: error.message,
        });
      }
      console.error("Could not calculate the Finance installment schedule.", error);
      return res.status(500).json({
        status: "error",
        code: "FINANCE_SCHEDULE_PREVIEW_FAILED",
        message: "Could not calculate the installment schedule.",
      });
    }
  }
);

module.exports = router;
