const RESET_MIGRATION_NAME = "20260722_bank_biometric_device_reset_v1";

const RETIRED_MESSAGE =
  "Browser fingerprint, face and generic passkey login are retired. Password authentication remains authoritative.";

async function ensurePasskeySchema() {
  return {
    ready: true,
    retired: true,
    runtime_mutation_disabled: true,
    message: RETIRED_MESSAGE,
  };
}

async function getBiometricGeneration() {
  return 1;
}

async function revokeUserBiometrics() {
  return 0;
}

module.exports = {
  RESET_MIGRATION_NAME,
  RETIRED_MESSAGE,
  ensurePasskeySchema,
  getBiometricGeneration,
  revokeUserBiometrics,
};
