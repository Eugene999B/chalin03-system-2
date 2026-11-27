const express = require("express");
const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  EquipmentFinancePaymentHistoryError,
  listPaymentHistory,
} = require("../services/equipmentFinancePaymentHistoryService");

const router = express.Router();

function sendError(res, error, fallback) {
  const statusCode = Number(error?.statusCode || 500);
  return res.status(statusCode).json({
    status: "error",
    code: error?.code || "EQUIPMENT_FINANCE_PAYMENT_HISTORY_ERROR",
    message: error?.message || fallback,
  });
}

router.get(
  "/phase6/payment-history",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const history = await listPaymentHistory({
        search: req.query.search,
        dateFrom: req.query.date_from,
        dateTo: req.query.date_to,
        paymentMethod: req.query.payment_method,
        paymentCategory: req.query.payment_category,
        status: req.query.status,
        sortBy: req.query.sort_by,
        sortDir: req.query.sort_dir,
        page: req.query.page,
        pageSize: req.query.page_size,
      });
      return res.json({ status: "success", ...history });
    } catch (error) {
      if (error instanceof EquipmentFinancePaymentHistoryError) {
        return sendError(res, error, "Could not load Finance payment history.");
      }
      return sendError(res, error, "Could not load Finance payment history.");
    }
  }
);

module.exports = router;
