const Module = require("module");
const express = require("express");
const { pool } = require("../config/db");

const PHOTO_LIMIT = 180000;
const PHOTO_PATTERN = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizePhoto(value) {
  const photo = String(value ?? "").trim();
  if (!photo) return null;
  if (!PHOTO_PATTERN.test(photo) || photo.length > PHOTO_LIMIT) {
    const error = new Error("Choose a customer photo again. It must be a compressed portrait image.");
    error.code = "INVALID_CUSTOMER_PROFILE_PHOTO";
    error.statusCode = 400;
    throw error;
  }
  return photo;
}

async function savePhoto(customerId, photo, updatedBy) {
  if (!photo) {
    await pool.query("UPDATE hire_customers SET profile_photo_data_url = NULL, updated_by = ? WHERE id = ?", [updatedBy || null, customerId]);
    return;
  }
  await pool.query(
    "UPDATE hire_customers SET profile_photo_data_url = ?, updated_by = ? WHERE id = ?",
    [photo, updatedBy || null, customerId]
  );
}

function patchCustomerRouter(router) {
  if (!router || router.__customerProfilePhotoBootstrap) return;
  router.__customerProfilePhotoBootstrap = true;

  const profileMiddleware = async (req, res, next) => {
    if (!["POST", "PUT", "PATCH"].includes(req.method)) return next();
    const path = String(req.path || "");
    if (!/^\/phase-one\/customers(?:\/\d+)?\/?$/.test(path)) return next();

    try {
      req.__customerProfilePhoto = req.body?.profile_photo_data_url === undefined
        ? undefined
        : normalizePhoto(req.body.profile_photo_data_url);
    } catch (error) {
      return res.status(error.statusCode || 400).json({ status: "error", code: error.code || "INVALID_CUSTOMER_PROFILE_PHOTO", message: error.message });
    }

    const originalJson = res.json.bind(res);
    res.json = async (payload) => {
      try {
        if (payload?.status === "success" && req.__customerProfilePhoto !== undefined) {
          const customerId = positiveId(req.params.customerId || payload?.customer?.id || payload?.id);
          if (customerId) await savePhoto(customerId, req.__customerProfilePhoto, req.user?.id);
        }
      } catch (error) {
        console.error("Customer profile photo persistence warning:", error);
        payload = {
          ...payload,
          photo_warning: "The customer profile was saved, but the optional photo could not be persisted yet.",
        };
      }
      return originalJson(payload);
    };
    return next();
  };

  const listEnricher = (req, res, next) => {
    if (req.method !== "GET" || String(req.path || "") !== "/phase-one/customers") return next();
    const originalJson = res.json.bind(res);
    res.json = async (payload) => {
      try {
        if (Array.isArray(payload?.customers) && payload.customers.length) {
          const ids = payload.customers.map((customer) => positiveId(customer.id)).filter(Boolean);
          if (ids.length) {
            const placeholders = ids.map(() => "?").join(",");
            const [rows] = await pool.query(`SELECT id FROM hire_customers WHERE id IN (${placeholders}) AND profile_photo_data_url IS NOT NULL AND CHAR_LENGTH(profile_photo_data_url) > 0`, ids);
            const withPhoto = new Set(rows.map((row) => Number(row.id)));
            payload = { ...payload, customers: payload.customers.map((customer) => ({ ...customer, profile_photo_present: withPhoto.has(Number(customer.id)) })) };
          }
        }
      } catch (error) {
        if (error?.code !== "ER_BAD_FIELD_ERROR") console.error("Customer photo list enrichment warning:", error);
      }
      return originalJson(payload);
    };
    return next();
  };

  const routes = express.Router();
  routes.use(profileMiddleware);
  routes.use(listEnricher);
  routes.get("/phase-one/customers/:customerId/photo", async (req, res) => {
    try {
      const customerId = positiveId(req.params.customerId);
      if (!customerId) return res.status(400).json({ status: "error", code: "INVALID_CUSTOMER_ID", message: "Choose a valid customer." });
      const [rows] = await pool.query("SELECT profile_photo_data_url FROM hire_customers WHERE id = ? AND is_active = TRUE LIMIT 1", [customerId]);
      if (!rows.length) return res.status(404).json({ status: "error", code: "FINANCE_CUSTOMER_NOT_FOUND", message: "Finance customer was not found." });
      return res.json({ status: "success", exists: Boolean(rows[0].profile_photo_data_url), photo: rows[0].profile_photo_data_url || null });
    } catch (error) {
      if (error?.code === "ER_BAD_FIELD_ERROR") return res.status(503).json({ status: "error", code: "CUSTOMER_PROFILE_PHOTO_MIGRATION_REQUIRED", message: "Customer photo storage is awaiting its approved database migration." });
      return res.status(500).json({ status: "error", code: "CUSTOMER_PROFILE_PHOTO_LOAD_FAILED", message: "The customer photo could not be loaded." });
    }
  });
  routes.delete("/phase-one/customers/:customerId/photo", async (req, res) => {
    try {
      const customerId = positiveId(req.params.customerId);
      if (!customerId) return res.status(400).json({ status: "error", code: "INVALID_CUSTOMER_ID", message: "Choose a valid customer." });
      await pool.query("UPDATE hire_customers SET profile_photo_data_url = NULL, updated_by = ? WHERE id = ?", [req.user?.id || null, customerId]);
      return res.json({ status: "success", message: "Customer photo removed." });
    } catch (error) {
      if (error?.code === "ER_BAD_FIELD_ERROR") return res.status(503).json({ status: "error", code: "CUSTOMER_PROFILE_PHOTO_MIGRATION_REQUIRED", message: "Customer photo storage is awaiting its approved database migration." });
      return res.status(500).json({ status: "error", code: "CUSTOMER_PROFILE_PHOTO_DELETE_FAILED", message: "The customer photo could not be removed." });
    }
  });

  router.stack.unshift(...routes.stack);
}

function patchProfessionalService(service) {
  if (!service || service.__customerProfilePhotoBootstrap) return;
  service.__customerProfilePhotoBootstrap = true;
  if (typeof service.loadAgreementSnapshot === "function") {
    const originalSnapshot = service.loadAgreementSnapshot;
    service.loadAgreementSnapshot = async (...args) => {
      const snapshot = await originalSnapshot(...args);
      const agreementId = positiveId(args[0]);
      if (!agreementId || !snapshot?.agreement) return snapshot;
      try {
        const [rows] = await pool.query("SELECT profile_photo_data_url FROM hire_customers WHERE id = ? LIMIT 1", [snapshot.agreement.customer_id]);
        snapshot.agreement.customer_profile_photo_data_url = rows[0]?.profile_photo_data_url || null;
      } catch (error) {
        if (error?.code !== "ER_BAD_FIELD_ERROR") console.error("Agreement customer portrait load warning:", error);
      }
      return snapshot;
    };
  }
  if (typeof service.renderAgreementWord === "function") {
    const originalWord = service.renderAgreementWord;
    service.renderAgreementWord = (snapshot, ...args) => {
      const buffer = originalWord(snapshot, ...args);
      if (!Buffer.isBuffer(buffer) || !snapshot?.agreement?.customer_profile_photo_data_url) return buffer;
      try {
        const html = buffer.toString("utf8");
        const photo = snapshot.agreement.customer_profile_photo_data_url;
        const inserted = html.replace(
          /<h3>Parties<\/h3>/,
          `<h3>Parties<\/h3><div style="margin:8px 0 12px;"><img src="${photo}" alt="Customer portrait" style="width:80px;height:103px;object-fit:cover;border:1px solid #d7e1d9;border-radius:6px;" /></div>`
        );
        return Buffer.from(inserted, "utf8");
      } catch (error) {
        console.error("Agreement Word customer portrait warning:", error);
        return buffer;
      }
    };
  }
}

const originalLoad = Module._load;
Module._load = function patchedModuleLoad(request, parent, isMain) {
  const exported = originalLoad.apply(this, arguments);
  const requestText = String(request || "");
  if (/equipmentFinancePhaseOneRoutes\.js$/.test(requestText)) patchCustomerRouter(exported);
  if (/equipmentFinanceProfessionalService\.js$/.test(requestText)) patchProfessionalService(exported);
  return exported;
};
