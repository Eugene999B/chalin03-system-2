const express = require("express");

const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  uploadDocument,
} = require("../services/equipmentFinancePrivateDocumentsService");

const router = express.Router();
const MAX_CUSTOMER_PHOTO_BYTES = 1536 * 1024;
const START_PATH = "/phase-one/start-installment";

function cleanText(value, maximum = 255) {
  return String(value ?? "").trim().slice(0, maximum);
}

function positiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function parseCustomerPhoto(value) {
  if (!value) return null;
  const dataUrl = cleanText(value.data_url, 3 * 1024 * 1024);
  const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(
    dataUrl
  );
  if (!match) {
    const error = new Error("Choose a valid JPEG, PNG or WebP customer picture.");
    error.statusCode = 400;
    error.code = "FINANCE_CUSTOMER_PHOTO_INVALID";
    throw error;
  }
  const mimeType = match[1].toLowerCase() === "image/jpg"
    ? "image/jpeg"
    : match[1].toLowerCase();
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > MAX_CUSTOMER_PHOTO_BYTES) {
    const error = new Error(
      "The compressed customer picture must be below 1.5 MB. Choose the picture again so the browser can recompress it."
    );
    error.statusCode = 413;
    error.code = "FINANCE_CUSTOMER_PHOTO_TOO_LARGE";
    throw error;
  }
  return {
    mime_type: mimeType,
    file_name:
      cleanText(value.file_name, 180) ||
      `customer-passport-photo.${mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg"}`,
    content_base64: match[2],
    file_size_bytes: buffer.length,
    width: positiveId(value.width),
    height: positiveId(value.height),
  };
}

function successfulCreation(res, payload) {
  return (
    Number(res.statusCode) >= 200 &&
    Number(res.statusCode) < 300 &&
    positiveId(payload?.application?.id)
  );
}

router.post(
  START_PATH,
  requirePermission("fleet.assets.manage"),
  (req, res, next) => {
    let photo;
    try {
      photo = parseCustomerPhoto(req.body?.customer_photo);
    } catch (error) {
      return res.status(Number(error.statusCode || 400)).json({
        status: "error",
        code: error.code || "FINANCE_CUSTOMER_PHOTO_INVALID",
        message: error.message,
      });
    }

    if (!photo) return next();

    const body = { ...(req.body || {}) };
    delete body.customer_photo;
    req.body = body;

    const originalJson = res.json.bind(res);
    let handled = false;
    res.json = (payload) => {
      if (handled || !successfulCreation(res, payload)) {
        return originalJson(payload);
      }
      handled = true;
      const applicationId = positiveId(payload.application.id);
      return uploadDocument({
        applicationId,
        input: {
          document_category: "kyc_identity",
          document_type: "customer_passport_photo",
          file_name: photo.file_name,
          mime_type: photo.mime_type,
          content_base64: photo.content_base64,
        },
        actor: positiveId(req.user?.id),
        req,
      })
        .then((document) =>
          originalJson({
            ...payload,
            customer_photo: {
              stored: true,
              document_id: document.id,
              document_number: document.document_number,
              mime_type: document.mime_type,
              file_size_bytes: document.file_size_bytes,
              width: photo.width,
              height: photo.height,
              message:
                "Customer passport picture was compressed and encrypted inside the Finance document vault.",
            },
          })
        )
        .catch((error) => {
          console.error("Finance customer passport photo storage warning:", error);
          return originalJson({
            ...payload,
            customer_photo: {
              stored: false,
              message:
                error?.message ||
                "The application was created, but the customer picture still needs to be uploaded from the private document workspace.",
            },
          });
        });
    };

    return next();
  }
);

module.exports = router;
module.exports.MAX_CUSTOMER_PHOTO_BYTES = MAX_CUSTOMER_PHOTO_BYTES;
module.exports.parseCustomerPhoto = parseCustomerPhoto;
module.exports.successfulCreation = successfulCreation;
