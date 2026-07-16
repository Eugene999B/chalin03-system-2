const crypto = require("crypto");

const BASE32_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const RECOVERY_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function securityError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function encryptionKey() {
  const configured = String(
    process.env.OWNER_MFA_ENCRYPTION_KEY || ""
  ).trim();

  if (configured.length < 32) {
    throw securityError(
      "OWNER_MFA_ENCRYPTION_KEY must contain at least 32 characters.",
      "OWNER_MFA_ENCRYPTION_KEY_MISSING"
    );
  }

  return crypto
    .createHash("sha256")
    .update(configured)
    .digest();
}

function encryptMfaSecret(secret) {
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    encryptionKey(),
    iv
  );

  const ciphertext = Buffer.concat([
    cipher.update(String(secret), "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    version: 1,
  };
}

function decryptMfaSecret({
  ciphertext,
  iv,
  tag,
}) {
  if (!ciphertext || !iv || !tag) {
    throw securityError(
      "The Owner MFA secret is incomplete.",
      "OWNER_MFA_SECRET_INCOMPLETE"
    );
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64")
  );

  decipher.setAuthTag(
    Buffer.from(tag, "base64")
  );

  return Buffer.concat([
    decipher.update(
      Buffer.from(ciphertext, "base64")
    ),
    decipher.final(),
  ]).toString("utf8");
}

function base32Encode(input) {
  const bytes = Buffer.from(input);

  const binary = Array.from(bytes)
    .map((byte) =>
      byte.toString(2).padStart(8, "0")
    )
    .join("");

  let output = "";

  for (
    let index = 0;
    index < binary.length;
    index += 5
  ) {
    const chunk = binary
      .slice(index, index + 5)
      .padEnd(5, "0");

    output +=
      BASE32_ALPHABET[
        Number.parseInt(chunk, 2)
      ];
  }

  return output;
}

function base32Decode(value) {
  const normalized = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, "");

  if (!normalized) {
    throw securityError(
      "The MFA secret is invalid.",
      "OWNER_MFA_SECRET_INVALID"
    );
  }

  const binary = Array.from(normalized)
    .map((character) => {
      const index =
        BASE32_ALPHABET.indexOf(character);

      if (index < 0) {
        throw securityError(
          "The MFA secret is invalid.",
          "OWNER_MFA_SECRET_INVALID"
        );
      }

      return index
        .toString(2)
        .padStart(5, "0");
    })
    .join("");

  const bytes = [];

  for (
    let index = 0;
    index + 8 <= binary.length;
    index += 8
  ) {
    bytes.push(
      Number.parseInt(
        binary.slice(index, index + 8),
        2
      )
    );
  }

  return Buffer.from(bytes);
}

function generateTotpSecret() {
  return base32Encode(
    crypto.randomBytes(20)
  );
}

function totpAt(
  secret,
  {
    timestamp = Date.now(),
    stepSeconds = 30,
    digits = 6,
  } = {}
) {
  const counter = Math.floor(
    timestamp / 1000 / stepSeconds
  );

  const counterBuffer = Buffer.alloc(8);

  counterBuffer.writeBigUInt64BE(
    BigInt(counter)
  );

  const digest = crypto
    .createHmac(
      "sha1",
      base32Decode(secret)
    )
    .update(counterBuffer)
    .digest();

  const offset =
    digest[digest.length - 1] & 0x0f;

  const binaryCode =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(
    binaryCode % 10 ** digits
  ).padStart(digits, "0");
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(
    String(left || "")
  );

  const rightBuffer = Buffer.from(
    String(right || "")
  );

  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(
      leftBuffer,
      rightBuffer
    )
  );
}

function verifyTotpCode(
  secret,
  suppliedCode,
  {
    timestamp = Date.now(),
    window = 1,
  } = {}
) {
  const normalized = String(
    suppliedCode || ""
  )
    .replace(/\D/g, "")
    .slice(0, 6);

  if (normalized.length !== 6) {
    return false;
  }

  for (
    let offset = -window;
    offset <= window;
    offset += 1
  ) {
    const expected = totpAt(secret, {
      timestamp:
        timestamp + offset * 30 * 1000,
    });

    if (
      secureEqual(expected, normalized)
    ) {
      return true;
    }
  }

  return false;
}

function normalizeRecoveryCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function hashRecoveryCode(value) {
  return crypto
    .createHash("sha256")
    .update(normalizeRecoveryCode(value))
    .digest("hex");
}

function randomRecoveryCharacter() {
  return RECOVERY_ALPHABET[
    crypto.randomInt(
      0,
      RECOVERY_ALPHABET.length
    )
  ];
}

function generateRecoveryCodes(count = 8) {
  const codes = new Set();

  while (codes.size < count) {
    const raw = Array.from(
      { length: 10 },
      randomRecoveryCharacter
    ).join("");

    codes.add(
      `${raw.slice(0, 5)}-${raw.slice(5)}`
    );
  }

  return Array.from(codes);
}

function buildOtpAuthUri({
  secret,
  username,
  issuer = "Chalin 03 Company Limited",
}) {
  const account = String(
    username || "Owner"
  ).trim();

  const label = encodeURIComponent(
    `${issuer}:${account}`
  );

  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });

  return `otpauth://totp/${label}?${params.toString()}`;
}

module.exports = {
  base32Decode,
  base32Encode,
  buildOtpAuthUri,
  decryptMfaSecret,
  encryptMfaSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  totpAt,
  verifyTotpCode,
};
