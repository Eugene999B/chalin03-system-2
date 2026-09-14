const express = require("express");

const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  FinanceProtectedImageError,
  loadApplicationProtectedImage,
  loadAssetProtectedImage,
} = require("../services/equipmentFinanceProtectedImageService");
const criticalEntry = require("./equipmentFinanceCriticalEntryRoutes");

const router = express.Router();
const VIEW_PERMISSION = "fleet.assets.view";

function positiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function protectedAssetPath(assetId, photoId) {
  return `/equipment-catalogue/sales/protected-images/assets/${assetId}/${photoId}`;
}

function machineWithProtectedReferences(machine = {}) {
  const assetId = positiveId(machine.id);
  const media = Array.isArray(machine.media)
    ? machine.media.map((item) => {
        const photoId = positiveId(item.id);
        const imagePath = assetId && photoId
          ? protectedAssetPath(assetId, photoId)
          : null;
        return { ...item, file_url: imagePath, image_path: imagePath };
      })
    : [];
  const primary = media.find((item) => item.is_primary && item.image_path);
  const first = media.find((item) => item.image_path);
  const legacyPath = assetId && machine.has_legacy_image
    ? protectedAssetPath(assetId, "legacy")
    : null;
  const mainImagePath = primary?.image_path || first?.image_path || legacyPath;

  return {
    ...machine,
    media,
    main_image_url: mainImagePath || null,
    main_image_path: mainImagePath || null,
    has_image: Boolean(mainImagePath),
    photo_count: Number(machine.photo_count || media.length || 0),
  };
}

function fallbackSettings() {
  return {
    currency: "GHS",
    minimum_deposit_percent: 0,
    default_payment_frequency: "monthly",
    default_first_due_days: 30,
    maximum_term_months: 120,
    maximum_installment_count: 520,
    delivery_policy: "after_deposit",
    compatibility_mode: true,
  };
}

function sendError(req, res, error, fallbackMessage) {
  if (error instanceof FinanceProtectedImageError) {
    return res.status(error.statusCode).json({
      status: "error",
      code: error.code,
      message: error.message,
      request_id: req.requestId || null,
    });
  }
  console.error(fallbackMessage, {
    request_id: req.requestId || null,
    code: error?.code || null,
    message: error?.message || null,
  });
  return res.status(503).json({
    status: "error",
    code: "FINANCE_PROTECTED_IMAGE_UNAVAILABLE",
    message: fallbackMessage,
    request_id: req.requestId || null,
    retryable: true,
  });
}

function sendImage(res, image) {
  if (!image?.buffer?.length || !String(image.mimeType || "").startsWith("image/")) {
    throw new FinanceProtectedImageError(
      415,
      "The protected excavator picture did not produce valid browser image bytes.",
      "FINANCE_PROTECTED_IMAGE_INVALID_OUTPUT"
    );
  }
  res.setHeader("Content-Type", image.mimeType);
  res.setHeader("Content-Length", String(image.buffer.length));
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Chalin03-Image-Width", String(image.width || 0));
  res.setHeader("X-Chalin03-Image-Height", String(image.height || 0));
  res.setHeader("X-Chalin03-Image-Transcoded", image.transcoded ? "1" : "0");
  return res.status(200).send(image.buffer);
}

router.get(
  "/phase-one/bootstrap",
  requirePermission(VIEW_PERMISSION),
  async (req, res) => {
    const [customerResult, machineResult] = await Promise.allSettled([
      criticalEntry.loadCustomers(),
      criticalEntry.loadMachines(req),
    ]);
    const customers = customerResult.status === "fulfilled" ? customerResult.value : [];
    const machines = machineResult.status === "fulfilled"
      ? machineResult.value.map(machineWithProtectedReferences)
      : [];
    const failures = [
      customerResult.status === "rejected" ? "customers" : null,
      machineResult.status === "rejected" ? "excavators" : null,
    ].filter(Boolean);

    if (customerResult.status === "rejected") {
      console.error("Phase 2 Finance customer bootstrap degraded:", {
        request_id: req.requestId || null,
        code: customerResult.reason?.code || null,
        message: customerResult.reason?.message || null,
      });
    }
    if (machineResult.status === "rejected") {
      console.error("Phase 2 Finance machine bootstrap degraded:", {
        request_id: req.requestId || null,
        code: machineResult.reason?.code || null,
        message: machineResult.reason?.message || null,
      });
    }

    return res.json({
      status: failures.length ? "degraded" : "success",
      message: failures.length
        ? `The ${failures.join(" and ")} list could not finish, but the installment screen was released for use.`
        : "Finance customer and excavator lists loaded.",
      request_id: req.requestId || null,
      customers,
      machines,
      settings: fallbackSettings(),
      settings_readiness: {
        ready: true,
        degraded: failures.length > 0,
        compatibility_mode: true,
      },
      policy: {
        scope: "company_wide",
        hire_location_id: null,
        hire_location_selection_required: false,
        installment_offer_created_automatically: true,
        exact_schedule_preview_enabled: true,
        optional_draft_kyc_and_affordability: true,
        list_contains_image_bytes: false,
        application_transaction_contains_image_bytes: false,
        authenticated_blob_images: true,
        signed_machine_images: false,
      },
    });
  }
);

router.get(
  "/professional/machine-register",
  requirePermission(VIEW_PERMISSION),
  async (req, res) => {
    try {
      const machines = (await criticalEntry.loadMachines(req)).map(
        machineWithProtectedReferences
      );
      return res.json({
        status: "success",
        request_id: req.requestId || null,
        count: machines.length,
        machines,
        image_policy: {
          list_contains_image_bytes: false,
          authenticated_blob_images: true,
          direct_img_api_urls_forbidden: true,
        },
      });
    } catch (error) {
      return sendError(req, res, error, "Could not load the protected Finance Machine Register.");
    }
  }
);

router.get(
  "/protected-images/assets/:assetId/:photoId",
  requirePermission(VIEW_PERMISSION),
  async (req, res) => {
    try {
      const image = await loadAssetProtectedImage({
        assetId: req.params.assetId,
        photoId: req.params.photoId,
      });
      return sendImage(res, image);
    } catch (error) {
      return sendError(req, res, error, "The excavator picture is temporarily unavailable.");
    }
  }
);

router.get(
  "/protected-images/applications/:applicationId",
  requirePermission(VIEW_PERMISSION),
  async (req, res) => {
    try {
      return sendImage(res, await loadApplicationProtectedImage(req.params.applicationId));
    } catch (error) {
      return sendError(req, res, error, "The application excavator picture is temporarily unavailable.");
    }
  }
);

router.get(
  "/credit-applications/:applicationId/image",
  requirePermission(VIEW_PERMISSION),
  async (req, res) => {
    try {
      return sendImage(res, await loadApplicationProtectedImage(req.params.applicationId));
    } catch (error) {
      return sendError(req, res, error, "The application excavator picture is temporarily unavailable.");
    }
  }
);

module.exports = router;
module.exports.machineWithProtectedReferences = machineWithProtectedReferences;
module.exports.protectedAssetPath = protectedAssetPath;
module.exports.sendImage = sendImage;