const crypto = require("crypto");

const DERIVATION_CONTEXT = "CHALIN03|INVENTORY_LABEL_SIGNING|V1";

function clean(value) {
  return String(value || "").trim();
}

function strongEnough(value) {
  return Buffer.byteLength(clean(value), "utf8") >= 32;
}

function ensureInventoryLabelSigningSecret() {
  const dedicated = clean(process.env.INVENTORY_LABEL_SIGNING_SECRET);
  if (strongEnough(dedicated)) {
    return { configured: true, source: "dedicated" };
  }

  const serverRoot = clean(process.env.JWT_SECRET);
  if (!strongEnough(serverRoot)) {
    return { configured: false, source: "missing" };
  }

  const derived = crypto
    .createHmac("sha256", serverRoot)
    .update(DERIVATION_CONTEXT, "utf8")
    .digest("base64url");

  process.env.INVENTORY_LABEL_SIGNING_SECRET = derived;
  return { configured: true, source: "derived_server_key" };
}

module.exports = {
  DERIVATION_CONTEXT,
  ensureInventoryLabelSigningSecret,
};
