const sharp = require("sharp");

const MAX_PROTECTED_IMAGE_BYTES = 47 * 1024;
const INSTALL_MARKER = Symbol.for(
  "chalin03.equipmentFinanceImageCompatibilityInstalled"
);
const MACHINE_PATCH_MARKER = Symbol.for(
  "chalin03.equipmentFinanceMachineEditCompatibilityInstalled"
);

const LEGACY_SAFE_ENUMS = {
  operational_purpose: new Set(["sale_only", "sale_or_hire"]),
  condition_status: new Set(["excellent", "good", "fair", "damaged", "under_inspection"]),
  ownership_type: new Set(["company_owned", "leased", "consignment", "customer_owned"]),
  meter_type: new Set(["hour_meter", "odometer"]),
};

function parseDataImage(value) {
  const match = String(value || "").match(
    /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/i
  );
  if (!match) return null;
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) return null;
  return {
    mime_type: match[1].toLowerCase().replace("image/jpg", "image/jpeg"),
    buffer,
  };
}

function dataUrl(mimeType, buffer) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

async function convertToProtectedJpeg(value) {
  const parsed = parseDataImage(value);
  if (!parsed) return value;
  if (
    ["image/jpeg", "image/png"].includes(parsed.mime_type) &&
    parsed.buffer.length <= MAX_PROTECTED_IMAGE_BYTES
  ) {
    return dataUrl(parsed.mime_type, parsed.buffer);
  }

  let width = 1280;
  let height = 960;
  let quality = 78;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const buffer = await sharp(parsed.buffer, { failOn: "none" })
      .rotate()
      .resize({
        width,
        height,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (buffer.length <= MAX_PROTECTED_IMAGE_BYTES) {
      return dataUrl("image/jpeg", buffer);
    }
    quality = Math.max(38, quality - 6);
    width = Math.max(520, Math.round(width * 0.86));
    height = Math.max(390, Math.round(height * 0.86));
  }

  throw new Error(
    "A Finance image could not be reduced to the protected document size. Capture a clearer picture with less background."
  );
}

async function normalizePhotoPayload(input = {}) {
  const output = { ...(input || {}) };
  if (!Array.isArray(output.photos)) return output;
  output.photos = await Promise.all(
    output.photos.map(async (photo) => ({
      ...photo,
      data_url: await convertToProtectedJpeg(photo?.data_url),
      file_name: String(photo?.file_name || "machine-photo")
        .replace(/\.(webp|png|jpe?g)$/i, "")
        .concat(".jpg"),
    }))
  );
  return output;
}

async function normalizeSnapshotImages(snapshot) {
  const output = structuredClone(snapshot || {});
  if (Array.isArray(output.media)) {
    output.media = await Promise.all(
      output.media.map(async (item) => ({
        ...item,
        file_url: await convertToProtectedJpeg(item.file_url),
        thumbnail_url: await convertToProtectedJpeg(item.thumbnail_url),
      }))
    );
  }
  if (output.agreement?.main_image_url) {
    output.agreement.main_image_url = await convertToProtectedJpeg(
      output.agreement.main_image_url
    );
  }
  if (output.company?.authorised_seller_signature_data_url) {
    output.company.authorised_seller_signature_data_url =
      await convertToProtectedJpeg(
        output.company.authorised_seller_signature_data_url
      );
  }
  if (Array.isArray(output.signatures)) {
    output.signatures = await Promise.all(
      output.signatures.map(async (signature) => ({
        ...signature,
        signature_data_url: await convertToProtectedJpeg(
          signature.signature_data_url
        ),
      }))
    );
  }
  return output;
}

function installFinanceImageCompatibility() {
  const service = require("./equipmentFinanceProfessionalService");
  if (service[INSTALL_MARKER]) return service;

  const originalGetIssuedDocument = service.getIssuedDocument;
  const originalSaveSignature = service.saveSignature;
  const originalUpdateSettings = service.updateProfessionalSettings;

  service.getIssuedDocument = async (...args) => {
    const document = await originalGetIssuedDocument(...args);
    return {
      ...document,
      snapshot: await normalizeSnapshotImages(document.snapshot),
    };
  };

  service.saveSignature = async (input = {}) =>
    originalSaveSignature({
      ...input,
      signatureDataUrl: await convertToProtectedJpeg(input.signatureDataUrl),
    });

  service.updateProfessionalSettings = async (input = {}) => {
    const body = { ...(input.body || {}) };
    if (body.authorised_seller_signature_data_url) {
      body.authorised_seller_signature_data_url = await convertToProtectedJpeg(
        body.authorised_seller_signature_data_url
      );
    }
    return originalUpdateSettings({ ...input, body });
  };

  const machineService = require("./equipmentFinanceMachineRegisterService");
  if (!machineService[MACHINE_PATCH_MARKER]) {
    const originalUpdateMachine = machineService.updateFinanceMachine;
    machineService.updateFinanceMachine = async (input = {}) => {
      const nextInput = { ...(input || {}) };
      const machineId = Number(input.assetId || 0);
      if (machineId > 0) {
        try {
          const [rows] = await require("../config/db").pool.query(
            "SELECT hire_location_id FROM fleet_assets WHERE id = ? LIMIT 1",
            [machineId]
          );
          const existingLocationId = Number(rows[0]?.hire_location_id || 0);
          const requestedLocationId = Number(input?.input?.equipment_origin_location_id || 0);
          if (
            requestedLocationId > 0 &&
            existingLocationId > 0 &&
            requestedLocationId === existingLocationId
          ) {
            const cleaned = { ...(input.input || {}) };
            delete cleaned.equipment_origin_location_id;
            delete cleaned.hire_location_id;
            nextInput.input = cleaned;
          }
        } catch {
          // The underlying update route remains authoritative if compatibility lookup fails.
        }
      }

      const cleaned = { ...(nextInput.input || {}) };
      for (const [field, allowed] of Object.entries(LEGACY_SAFE_ENUMS)) {
        if (
          Object.prototype.hasOwnProperty.call(cleaned, field) &&
          cleaned[field] !== undefined &&
          cleaned[field] !== null &&
          cleaned[field] !== ""
        ) {
          const normalized = String(cleaned[field]).trim().toLowerCase().replace(/[\s-]+/g, "_");
          if (!allowed.has(normalized)) delete cleaned[field];
        }
      }
      nextInput.input = cleaned;
      return originalUpdateMachine(nextInput);
    };
    Object.defineProperty(machineService, MACHINE_PATCH_MARKER, {
      value: true,
      enumerable: false,
    });
  }

  Object.defineProperty(service, INSTALL_MARKER, {
    value: true,
    enumerable: false,
  });
  return service;
}

module.exports = {
  MAX_PROTECTED_IMAGE_BYTES,
  convertToProtectedJpeg,
  installFinanceImageCompatibility,
  normalizePhotoPayload,
  normalizeSnapshotImages,
};