const BINDING_KEY = "chalin03_biometric_binding_v2";

export const WEB_BIOMETRIC_ENABLED = false;

function disabledError() {
  const error = new Error(
    "Fingerprint and face login are disabled in the Chalin 03 website. Browser passkeys and device screen-lock prompts cannot prove that a real fingerprint or face sensor was used. Sign in with your account password."
  );
  error.code = "WEB_BIOMETRIC_DISABLED";
  return error;
}

export function getStoredBiometricBinding() {
  return null;
}

export function clearStoredBiometricBinding() {
  try {
    localStorage.removeItem(BINDING_KEY);
  } catch {
    // Storage may be unavailable in privacy-restricted browsers.
  }
}

export function saveStoredBiometricBinding() {
  clearStoredBiometricBinding();
  return null;
}

export async function isBiometricAccessAvailable() {
  clearStoredBiometricBinding();
  return false;
}

export function supportsBiometricAccess() {
  return false;
}

export async function validateStoredBiometricBinding() {
  clearStoredBiometricBinding();
  return {
    valid: false,
    stored: null,
    available: false,
    disabled: true,
  };
}

export async function registerBiometricDevice() {
  clearStoredBiometricBinding();
  throw disabledError();
}

export async function authenticateWithBiometric() {
  clearStoredBiometricBinding();
  throw disabledError();
}
