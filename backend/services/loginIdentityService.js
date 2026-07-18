const { normalizeGhanaPhone } = require("./smsService");

function cleanIdentifier(value) {
  return String(value || "").trim().slice(0, 120);
}

function looksLikePhone(value) {
  const text = cleanIdentifier(value);

  if (!text) {
    return false;
  }

  const digits = text.replace(/[^0-9]/g, "");

  return (
    digits.length >= 9 &&
    /^[+()\-\s0-9]+$/.test(text)
  );
}

function normalizeLoginIdentity(value) {
  const identifier = cleanIdentifier(value);

  if (!identifier) {
    return {
      identifier: "",
      method: "username",
      normalizedPhone: null,
    };
  }

  if (looksLikePhone(identifier)) {
    const normalizedPhone = normalizeGhanaPhone(identifier);

    if (normalizedPhone) {
      return {
        identifier,
        method: "phone",
        normalizedPhone,
      };
    }
  }

  return {
    identifier,
    method: "username",
    normalizedPhone: null,
  };
}

function normalizedPhoneForStorage(value) {
  return normalizeGhanaPhone(value) || null;
}

module.exports = {
  cleanIdentifier,
  looksLikePhone,
  normalizeLoginIdentity,
  normalizedPhoneForStorage,
};
