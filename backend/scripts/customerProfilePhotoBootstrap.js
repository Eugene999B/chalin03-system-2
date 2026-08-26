const Module = require("module");
const express = require("express");
const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { sensitiveAdminLimiter } = require("../middleware/securityMiddleware");
const PHOTO_LIMIT = 180000;
const PHOTO_PATTERN = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
function positiveId(value) { const number = Number(value); return Number.isInteger(number) && number > 0 ? number : null; }
function normalizePhoto(value) { const photo = String(value ?? "").trim(); if (!photo) return null; if (!PHOTO_PATTERN.test(photo) || photo.length > PHOTO_LIMIT) { const error = new Error("Choose the customer photo again. It must be a compressed portrait image."); error.code = "INVALID_CUSTOMER_PROFILE_PHOTO"; error.statusCode = 400; throw error; } return photo; }
async function savePhoto(customerId, photo, updatedBy) { await pool.query("UPDATE hire_customers SET profile_photo_data_url = ?, updated_by = ? WHERE id = ?", [photo || null, updatedBy || null, customerId]); }
function patchCustomerRouter(router) {
  if (!router || router.__customerProfilePhotoBootstrap) return;
  router.__customerProfilePhotoBootstrap = true;
  const profileMiddleware = (req, res, next) => {
    if (!["POST","PUT","PATCH"].includes(req.method)) return next();
    if (!/^\/phase-one\/customers(?:\/\d+)?\/?$/.test(String(req.path || ""))) return next();
    const permissions = Array.isArray(req.user?.effective_permissions) ? req.user.effective_permissions : [];
    const role = String(req.user?.role || "").toLowerCase();
    const canManage = permissions.includes("fleet.assets.manage") || ["admin","administrator","manager","system_administrator","super_admin"].includes(role);
    if (!canManage) return res.status(403).json({ status:"error", code:"FLEET_ASSET_MANAGE_PERMISSION_REQUIRED", message:"Your account cannot manage customer profiles." });
    try { req.__customerProfilePhoto = req.body?.profile_photo_data_url === undefined ? undefined : normalizePhoto(req.body.profile_photo_data_url); }
    catch (error) { return res.status(error.statusCode || 400).json({ status:"error", code:error.code || "INVALID_CUSTOMER_PROFILE_PHOTO", message:error.message }); }
    const originalJson = res.json.bind(res);
    res.json = async (payload) => {
      try { if (payload?.status === "success" && req.__customerProfilePhoto !== undefined) { const customerId = positiveId(req.params.customerId || payload?.customer?.id || payload?.id); if (customerId) await savePhoto(customerId, req.__customerProfilePhoto, req.user?.id); } }
      catch (error) { console.error("Customer profile photo persistence warning:", error); payload = { ...payload, photo_warning:"The customer profile was saved, but the optional photo could not be persisted yet." }; }
      return originalJson(payload);
    };
    next();
  };
  const routes = express.Router();
  routes.use(sensitiveAdminLimiter);
  routes.use(profileMiddleware);
  routes.get("/phase-one/customers/:customerId/photo", requirePermission("fleet.assets.view"), async (req,res) => {
    try { const id = positiveId(req.params.customerId); if (!id) return res.status(400).json({status:"error",code:"INVALID_CUSTOMER_ID",message:"Choose a valid customer."}); const [rows] = await pool.query("SELECT profile_photo_data_url FROM hire_customers WHERE id = ? AND is_active = TRUE LIMIT 1",[id]); if(!rows.length) return res.status(404).json({status:"error",code:"FINANCE_CUSTOMER_NOT_FOUND",message:"Finance customer was not found."}); return res.json({status:"success",exists:Boolean(rows[0].profile_photo_data_url),photo:rows[0].profile_photo_data_url||null}); }
    catch(error){ if(error?.code === "ER_BAD_FIELD_ERROR") return res.status(503).json({status:"error",code:"CUSTOMER_PROFILE_PHOTO_MIGRATION_REQUIRED",message:"Customer photo storage is awaiting its approved database migration."}); return res.status(500).json({status:"error",code:"CUSTOMER_PROFILE_PHOTO_LOAD_FAILED",message:"The customer photo could not be loaded."}); }
  });
  routes.delete("/phase-one/customers/:customerId/photo", requirePermission("fleet.assets.manage"), async (req,res) => {
    try { const id=positiveId(req.params.customerId); if(!id) return res.status(400).json({status:"error",code:"INVALID_CUSTOMER_ID",message:"Choose a valid customer."}); await savePhoto(id,null,req.user?.id); return res.json({status:"success",message:"Customer photo removed."}); }
    catch(error){ if(error?.code === "ER_BAD_FIELD_ERROR") return res.status(503).json({status:"error",code:"CUSTOMER_PROFILE_PHOTO_MIGRATION_REQUIRED",message:"Customer photo storage is awaiting its approved database migration."}); return res.status(500).json({status:"error",code:"CUSTOMER_PROFILE_PHOTO_DELETE_FAILED",message:"The customer photo could not be removed."}); }
  });
  router.stack.unshift(...routes.stack);
}
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) { const exported = originalLoad.apply(this, arguments); if (/equipmentFinancePhaseOneRoutes\.js$/.test(String(request||""))) patchCustomerRouter(exported); return exported; };
