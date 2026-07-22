import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:5000/api";
const BINDING_KEY = "chalin03_biometric_binding_v2";

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

export function supportsBiometricAccess() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    browserSupportsWebAuthn()
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
  const stored = getStoredBiometricBinding();
  if (!stored?.bindingToken || !supportsBiometricAccess()) {
    return { valid: false, stored: null };
  }

  const response = await fetch(`${API_BASE_URL}/auth/biometrics/binding/status`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ binding_token: stored.bindingToken }),
  });
  const body = await parse(response);

  if (!body.valid) {
    clearStoredBiometricBinding();
    return { valid: false, stored: null };
  }

  const refreshed = saveStoredBiometricBinding({
    ...stored,
    account: body.account,
    device: body.device,
  });
  return { valid: true, stored: refreshed, account: body.account };
}

export async function registerBiometricDevice({ displayName }) {
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
