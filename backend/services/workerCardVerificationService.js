const crypto = require("node:crypto");
const QRCode = require("qrcode");

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function verificationSecret() {
  return (
    process.env.WORKER_CARD_VERIFY_SECRET ||
    process.env.JWT_SECRET ||
    "chalin03-local-worker-card-verification"
  );
}

function verificationPayload(profile = {}) {
  return [
    cleanText(profile.id_card_serial || profile.employee_number, 80),
    cleanText(profile.employee_number, 80),
    cleanText(profile.id_card_issue_date, 40).slice(0, 10),
    cleanText(profile.id_card_expiry_date, 40).slice(0, 10),
  ].join("|");
}

function createWorkerCardSignature(profile) {
  return crypto
    .createHmac("sha256", verificationSecret())
    .update(verificationPayload(profile))
    .digest("hex")
    .slice(0, 32);
}

function verifyWorkerCardSignature(profile, signature) {
  const expected = createWorkerCardSignature(profile);
  const supplied = cleanText(signature, 100).toLowerCase();

  if (!/^[a-f0-9]{32}$/.test(supplied)) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, "utf8");
  const suppliedBuffer = Buffer.from(supplied, "utf8");

  return (
    expectedBuffer.length === suppliedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

function verificationBaseUrl() {
  return cleanText(
    process.env.WORKER_CARD_VERIFY_BASE_URL ||
      process.env.PUBLIC_API_URL ||
      process.env.API_PUBLIC_URL ||
      "https://api.chalin03.com",
    300
  ).replace(/\/+$/, "");
}

function buildWorkerVerificationUrl(profile) {
  const serial = cleanText(
    profile?.id_card_serial || profile?.employee_number,
    80
  );
  const signature = createWorkerCardSignature(profile);

  return `${verificationBaseUrl()}/api/release2-final/worker-card-verification/${encodeURIComponent(
    serial
  )}?sig=${signature}`;
}

async function createVerificationQr(profile) {
  return QRCode.toBuffer(buildWorkerVerificationUrl(profile), {
    type: "png",
    width: 320,
    margin: 1,
    errorCorrectionLevel: "M",
    color: {
      dark: "#07182cff",
      light: "#ffffffff",
    },
  });
}

module.exports = {
  buildWorkerVerificationUrl,
  createVerificationQr,
  createWorkerCardSignature,
  verifyWorkerCardSignature,
  verificationPayload,
};
