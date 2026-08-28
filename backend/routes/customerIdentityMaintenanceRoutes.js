const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  getCustomerFeatureControls,
  updateCustomerFeatureControls,
  getFeatureDisabledMessage,
} = require("../services/customerFeatureControlService");

const router = express.Router();

function getBranchId(req) {
  const branchId = Number(req.user?.branch_id || req.user?.default_branch_id || 0);
  return Number.isInteger(branchId) && branchId > 0 ? branchId : 1;
}
function cleanText(value, maxLength) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return null;
  return maxLength ? text.slice(0, maxLength) : text;
}
function normalizePhone(value) { return cleanText(value, 40) || null; }
function validCustomerName(value) {
  const name = cleanText(value, 150);
  if (!name) return null;
  return name.split(/\s+/).filter(Boolean).length >= 2 ? name : null;
}
function parsePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

router.use(requireAuth);

router.get("/feature-controls", async (req, res) => {
  try {
    const controls = await getCustomerFeatureControls(getBranchId(req));
    return res.json({ status: "success", controls });
  } catch (error) {
    console.error("Get customer feature controls error:", error);
    return res.status(500).json({ status: "error", message: "Could not load customer data feature controls." });
  }
});

router.put("/feature-controls", requireRole("admin"), async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const controls = await updateCustomerFeatureControls(branchId, {
      customer_identity_editing_enabled: req.body?.customer_identity_editing_enabled,
      customer_merge_enabled: req.body?.customer_merge_enabled,
    });
    await writeAuditEvent({
      req, branchId, userId: req.user?.id || null,
      action: "UPDATE_CUSTOMER_FEATURE_CONTROLS",
      actionType: "UPDATE_CUSTOMER_FEATURE_CONTROLS",
      outcome: "success", severity: "notice", workspaceCode: "spare_parts",
      entityType: "customer_feature_controls", entityId: branchId,
      details: "Updated customer identity editing and merge feature visibility controls.",
      metadata: controls,
    });
    return res.json({ status: "success", message: "Customer data feature controls updated successfully.", controls });
  } catch (error) {
    console.error("Update customer feature controls error:", error);
    return res.status(500).json({ status: "error", message: "Could not update customer data feature controls." });
  }
});

router.patch("/customer/:customerId/identity", requireRole("admin", "manager"), async (req, res) => {
  const branchId = getBranchId(req);
  const customerId = parsePositiveInteger(req.params.customerId);
  if (!customerId) {
    return res.status(400).json({ status: "error", code: "INVALID_CUSTOMER_ID", message: "Customer ID must be a positive whole number." });
  }

  try {
    const controls = await getCustomerFeatureControls(branchId);
    if (!controls.customer_identity_editing_enabled) {
      return res.status(403).json({ status: "error", code: "CUSTOMER_IDENTITY_EDITING_DISABLED", message: getFeatureDisabledMessage("customer_identity_editing") });
    }
    const name = validCustomerName(req.body?.name);
    const phone = normalizePhone(req.body?.phone);
    const location = cleanText(req.body?.location, 180);
    if (!name) {
      return res.status(400).json({ status: "error", code: "CUSTOMER_NAME_REQUIRES_TWO_NAMES", message: "Customer name must contain at least two separate names, for example Appiah Eugene." });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [customers] = await connection.query(
        `SELECT id, name, phone, location FROM customers WHERE id = ? AND branch_id = ? LIMIT 1 FOR UPDATE`,
        [customerId, branchId]
      );
      const customer = customers[0];
      if (!customer) {
        await connection.rollback();
        return res.status(404).json({ status: "error", code: "CUSTOMER_NOT_FOUND", message: "Customer was not found in the selected store." });
      }
      const [debtRows] = await connection.query(
        `SELECT COUNT(*) AS debt_count FROM debts WHERE branch_id = ? AND customer_id = ?`,
        [branchId, customerId]
      );
      const debtCount = Number(debtRows[0]?.debt_count || 0);
      if (debtCount > 0 && !phone) {
        await connection.rollback();
        return res.status(400).json({ status: "error", code: "DEBT_CUSTOMER_PHONE_REQUIRED", message: "This customer has debt records, so a phone number is required before the identity can be saved." });
      }
      await connection.query(
        `UPDATE customers SET name = ?, phone = ?, location = ? WHERE id = ? AND branch_id = ?`,
        [name, phone, location, customerId, branchId]
      );
      await writeAuditEvent({
        connection, req, branchId, userId: req.user?.id || null,
        action: "EDIT_CUSTOMER_IDENTITY", actionType: "EDIT_CUSTOMER_IDENTITY",
        outcome: "success", severity: "notice", workspaceCode: "spare_parts",
        entityType: "customer", entityId: customerId,
        details: `Updated customer identity from ${customer.name || "unnamed"} to ${name}.`,
        metadata: { before: { name: customer.name || null, phone: customer.phone || null, location: customer.location || null }, after: { name, phone, location }, debt_count: debtCount },
      });
      await connection.commit();
      return res.json({ status: "success", message: "Customer details updated successfully.", customer: { id: customerId, name, phone, location }, debt_count: debtCount });
    } catch (transactionError) {
      try { await connection.rollback(); } catch {}
      throw transactionError;
    } finally { connection.release(); }
  } catch (error) {
    console.error("Edit customer identity error:", error);
    return res.status(500).json({ status: "error", message: "Could not update the selected customer details." });
  }
});

module.exports = router;
