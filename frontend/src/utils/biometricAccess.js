import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:5000/api";
const BINDING_KEY = "chalin03_biometric_binding_v2";

let platformAvailabilityPromise = null;
let platformAvailabilityResolved = false;
let platformAuthenticatorAvailable = false;

function token() {
  return localStorage.getItem("chalin03_token") || "";
}

function headers({ authenticated = false } = {}) {
  const result = { "Content-Type": "application/json" };
  if (authenticated && token()) result.Authorization = `Bearer ${token()}`;
  return result;
}

async function parse(response) {
  let body = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }

  if (!response.ok) {
    const error = new Error(
      body.message || "Fingerprint or face access could not be completed."
    );
    error.response = { status: response.status, data: body };
    throw error;
  }

  return body;
}

function hasBasicWebAuthnSupport() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    browserSupportsWebAuthn() &&
    typeof window.PublicKeyCredential !== "undefined"
  );
}

export async function isBiometricAccessAvailable() {
  if (!hasBasicWebAuthnSupport()) {
    platformAvailabilityResolved = true;
    platformAuthenticatorAvailable = false;
    return false;
  }

  if (
    typeof window.PublicKeyCredential
      .isUserVerifyingPlatformAuthenticatorAvailable !== "function"
  ) {
    platformAvailabilityResolved = true;
    platformAuthenticatorAvailable = false;
    return false;
  }

  if (!platformAvailabilityPromise) {
    platformAvailabilityPromise = window.PublicKeyCredential
      .isUserVerifyingPlatformAuthenticatorAvailable()
      .then((available) => Boolean(available))
      .catch(() => false)
      .then((available) => {
        platformAvailabilityResolved = true;
        platformAuthenticatorAvailable = available;
        return available;
      });
  }

  return platformAvailabilityPromise;
}

// Synchronous compatibility helper. The active login page first resolves
// isBiometricAccessAvailable(), so this returns true only after the browser has
// confirmed a built-in user-verifying platform authenticator.
export function supportsBiometricAccess() {
  return (
    hasBasicWebAuthnSupport() &&
    platformAvailabilityResolved &&
    platformAuthenticatorAvailable
  );
}

export function getStoredBiometricBinding() {
  try {
    const value = JSON.parse(localStorage.getItem(BINDING_KEY) || "null");
    if (!value?.bindingToken) return null;
    return value;
  } catch {
    return null;
  }
}

export function clearStoredBiometricBinding() {
  localStorage.removeItem(BINDING_KEY);
}

export function saveStoredBiometricBinding(binding) {
  localStorage.setItem(BINDING_KEY, JSON.stringify(binding));
  return binding;
}

export async function validateStoredBiometricBinding() {
  const available = await isBiometricAccessAvailable();
  const stored = getStoredBiometricBinding();

  if (!available || !stored?.bindingToken) {
    return { valid: false, stored: null, available };
  }

  const response = await fetch(`${API_BASE_URL}/auth/biometrics/binding/status`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ binding_token: stored.bindingToken }),
  });
  const body = await parse(response);

  if (!body.valid) {
    clearStoredBiometricBinding();
    return { valid: false, stored: null, available: true };
  }

  const refreshed = saveStoredBiometricBinding({
    ...stored,
    account: body.account,
    device: body.device,
  });
  return {
    valid: true,
    stored: refreshed,
    account: body.account,
    available: true,
  };
}

async function requirePlatformAuthenticator() {
  if (await isBiometricAccessAvailable()) return;

  const error = new Error(
    "This device does not report a built-in fingerprint or face authenticator. Use the account password on this device."
  );
  error.code = "PLATFORM_BIOMETRIC_UNAVAILABLE";
  throw error;
}

export async function registerBiometricDevice({ displayName }) {
  await requirePlatformAuthenticator();

  const optionsResponse = await fetch(
    `${API_BASE_URL}/auth/biometrics/registration/options`,
    {
      method: "POST",
      headers: headers({ authenticated: true }),
      body: JSON.stringify({ display_name: displayName }),
    }
  );
  const optionsBody = await parse(optionsResponse);

  const credentialResponse = await startRegistration({
    optionsJSON: optionsBody.options,
  });

  const verifyResponse = await fetch(
    `${API_BASE_URL}/auth/biometrics/registration/verify`,
    {
      method: "POST",
      headers: headers({ authenticated: true }),
      body: JSON.stringify({
        challenge_id: optionsBody.challenge_id,
        response: credentialResponse,
      }),
    }
  );
  const verified = await parse(verifyResponse);

  return saveStoredBiometricBinding({
    bindingToken: optionsBody.binding_token,
    account: verified.account,
    displayName,
    registeredAt: new Date().toISOString(),
  });
}

export async function authenticateWithBiometric({
  workspaceCode,
  branchId,
  deviceEvidence,
}) {
  await requirePlatformAuthenticator();

  const stored = getStoredBiometricBinding();
  if (!stored?.bindingToken) {
    const error = new Error(
      "This device is new or has been reset. Sign in with your password first."
    );
    error.code = "BIOMETRIC_BINDING_REQUIRED";
    throw error;
  }

  const optionsResponse = await fetch(
    `${API_BASE_URL}/auth/biometrics/authentication/options`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        binding_token: stored.bindingToken,
        workspace_code: workspaceCode,
        branch_id: workspaceCode === "spare_parts" ? Number(branchId) : null,
      }),
    }
  );
  const optionsBody = await parse(optionsResponse);

  const credentialResponse = await startAuthentication({
    optionsJSON: optionsBody.options,
  });

  const verifyResponse = await fetch(
    `${API_BASE_URL}/auth/biometrics/authentication/verify`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        challenge_id: optionsBody.challenge_id,
        response: credentialResponse,
        device_evidence: deviceEvidence || {},
      }),
    }
  );

  return parse(verifyResponse);
}
