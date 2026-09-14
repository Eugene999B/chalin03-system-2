import axios from "axios";
import { API_BASE_URL } from "./apiBaseUrl";
import "../utils/equipmentMediaCaptureBridge";
import {
  assertSparePartsInstallmentRequestAllowed,
} from "../utils/sparePartsInstallmentRetirementBridge";

const TOKEN_KEY = "chalin03_token";
const USER_KEY = "chalin03_user";
const REQUEST_TOKEN_KEY = "__chalin03RequestToken";
const STALE_SESSION_RETRY_KEY = "__chalin03StaleSessionRetried";
const FINANCE_APPLICATION_PATH = "/equipment-catalogue/sales/credit-applications";
const FINANCE_READINESS_PATH = `${FINANCE_APPLICATION_PATH}/readiness`;
const FINANCE_RESET_EXECUTE_PATH = "/equipment-catalogue/sales/completion-phase-four/reset/execute";
const FINANCE_READINESS_TIMEOUT_MS = 8000;
const FINANCE_APPLICATION_TIMEOUT_MS = 12000;
const FINANCE_RESET_TIMEOUT_MS = 120000;
const PUBLIC_SESSION_PATHS = new Set([
  "/auth/login",
  "/auth/recovery/request-otp",
  "/auth/recovery/reset-password",
  "/branches/public",
]);

// These are high-frequency background reads observed in production. A very short,
// account/branch-scoped cache collapses duplicate timers without caching sales,
// stock, debt balances, finance transactions or other business records.
const POLLING_READ_TTLS_MS = new Map([
  ["/audit-unlock-requests/operational", 30000],
  ["/sms/status", 60000],
  ["/sms/customers", 60000],
  ["/sms/logs", 45000],
]);
const pollingReadCache = new Map();
const pollingReadInFlight = new Map();

const axiosClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
});

function cleanRequestPath(value) {
  return String(value || "")
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^\/api(?=\/)/, "")
    .replace(/\?.*$/, "");
}

function isPublicSessionRequest(config) {
  return PUBLIC_SESSION_PATHS.has(cleanRequestPath(config?.url));
}

function isInstallmentFinanceScreen() {
  return typeof window !== "undefined" && window.location.pathname.startsWith("/equipment-installment-finance");
}

function isFinanceApplicationRead(config) {
  if (String(config?.method || "get").toLowerCase() !== "get") return false;
  const path = cleanRequestPath(config?.url);
  return path === FINANCE_APPLICATION_PATH || path === FINANCE_READINESS_PATH || new RegExp(`^${FINANCE_APPLICATION_PATH}/\\d+(?:/image)?$`).test(path);
}

function applyFinanceApplicationDeadline(config) {
  const path = cleanRequestPath(config?.url);
  const method = String(config?.method || "get").toLowerCase();
  if (method === "post" && path === FINANCE_RESET_EXECUTE_PATH) {
    const configuredTimeout = Number(config.timeout);
    config.timeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? Math.max(configuredTimeout, FINANCE_RESET_TIMEOUT_MS)
      : FINANCE_RESET_TIMEOUT_MS;
    return config;
  }
  if (!isFinanceApplicationRead(config)) return config;
  const deadline = path === FINANCE_READINESS_PATH ? FINANCE_READINESS_TIMEOUT_MS : FINANCE_APPLICATION_TIMEOUT_MS;
  const configuredTimeout = Number(config.timeout);
  config.timeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? Math.min(configuredTimeout, deadline) : deadline;
  return config;
}

function getStoredUser() {
  try {
    const storedUser = localStorage.getItem(USER_KEY);
    if (!storedUser) return null;
    return JSON.parse(storedUser);
  } catch {
    return null;
  }
}

function getStoredWorkspaceContextId(workspaceCode) {
  const keyMap = { mining: "chalin03_active_context_mining", equipment_hire: "chalin03_active_context_equipment_hire" };
  const key = keyMap[workspaceCode];
  if (!key) return "";
  const value = Number(localStorage.getItem(key));
  return Number.isInteger(value) && value > 0 ? String(value) : "";
}

function getStoredSessionInfo() {
  const user = getStoredUser();
  const workspaceCode = user?.workspace_code || user?.active_workspace?.code || "spare_parts";
  const isSparePartsWorkspace = workspaceCode === "spare_parts";
  const branchId = isSparePartsWorkspace ? user?.branch_id || user?.default_branch_id || user?.selected_branch?.id || user?.selected_branch?.branch_id || "" : "";
  const branchCode = isSparePartsWorkspace ? user?.branch_code || user?.code || user?.selected_branch?.branch_code || user?.selected_branch?.code || "" : "";
  const branchName = isSparePartsWorkspace ? user?.branch_name || user?.name || user?.selected_branch?.branch_name || user?.selected_branch?.name || "" : "";
  return { workspaceCode, branchId, branchCode, branchName };
}

function clearStoredSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem("chalin03_active_context_mining");
  localStorage.removeItem("chalin03_active_context_equipment_hire");
}

function buildCachedProfileResponse(error, cachedUser) {
  const workspaceCode = cachedUser?.workspace_code || cachedUser?.active_workspace?.code || "spare_parts";
  const workspaceName = cachedUser?.business_unit_name || cachedUser?.active_workspace?.name || (workspaceCode === "mining" ? "Mining Operations" : workspaceCode === "equipment_hire" ? "Equipment Hire" : "Spare Parts");
  return { data: { status: "degraded", message: "The secure session is active. Fresh profile details will be retried automatically.", workspace: { id: cachedUser?.business_unit_id || cachedUser?.active_workspace?.id || null, code: workspaceCode, name: workspaceName }, user: cachedUser }, status: 200, statusText: "OK", headers: error.response?.headers || {}, config: error.config, request: error.request };
}

function pollingReadTtl(url) {
  return POLLING_READ_TTLS_MS.get(cleanRequestPath(url)) || 0;
}

function stableParams(params) {
  if (!params || typeof params !== "object") return "";
  if (params instanceof URLSearchParams) return params.toString();
  try {
    return JSON.stringify(
      Object.keys(params)
        .sort()
        .reduce((result, key) => {
          result[key] = params[key];
          return result;
        }, {})
    );
  } catch {
    return String(params);
  }
}

function pollingReadKey(url, config = {}) {
  const user = getStoredUser();
  const { workspaceCode, branchId } = getStoredSessionInfo();
  return [
    user?.id || user?.user_id || "anonymous",
    workspaceCode || "",
    branchId || "",
    cleanRequestPath(url),
    stableParams(config.params),
  ].join("|");
}

function clonePollingValue(value) {
  if (value === undefined || value === null) return value;
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
  } catch {
    // Fall back to JSON cloning below for ordinary API payloads.
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function clearPollingReadCache(pathPrefix = "") {
  if (!pathPrefix) {
    pollingReadCache.clear();
    pollingReadInFlight.clear();
    return;
  }

  for (const key of pollingReadCache.keys()) {
    if (key.includes(`|${pathPrefix}`)) pollingReadCache.delete(key);
  }
  for (const key of pollingReadInFlight.keys()) {
    if (key.includes(`|${pathPrefix}`)) pollingReadInFlight.delete(key);
  }
}

function invalidatePollingReadCacheForRequest(config) {
  const method = String(config?.method || "get").toLowerCase();
  if (["get", "head", "options"].includes(method)) return;

  const path = cleanRequestPath(config?.url);
  if (path.startsWith("/sms")) clearPollingReadCache("/sms/");
  if (path.startsWith("/audit-unlock-requests")) {
    clearPollingReadCache("/audit-unlock-requests/operational");
  }
}

axiosClient.interceptors.request.use((config) => {
  assertSparePartsInstallmentRequestAllowed(config);
  invalidatePollingReadCacheForRequest(config);
  const token = localStorage.getItem(TOKEN_KEY) || "";
  const publicSessionRequest = isPublicSessionRequest(config);
  const requestToken = publicSessionRequest ? "" : token;
  const { workspaceCode, branchId, branchCode, branchName } = getStoredSessionInfo();
  const financeScreen = isInstallmentFinanceScreen();
  const workspaceContextId = financeScreen ? "" : getStoredWorkspaceContextId(workspaceCode);
  config[REQUEST_TOKEN_KEY] = requestToken;
  if (requestToken) config.headers.Authorization = `Bearer ${requestToken}`; else if (config.headers?.Authorization) delete config.headers.Authorization;
  if (workspaceCode) config.headers["X-Chalin03-Workspace"] = String(workspaceCode);
  if (financeScreen) { config.headers["X-Chalin03-Division"] = "installment_finance"; if (config.headers?.["X-Chalin03-Context-Id"]) delete config.headers["X-Chalin03-Context-Id"]; } else if (workspaceContextId) config.headers["X-Chalin03-Context-Id"] = workspaceContextId;
  // Branch headers are sent only for the Spare Parts workspace
  if (branchId) config.headers["X-Chalin03-Branch-Id"] = String(branchId);
  if (branchCode) config.headers["X-Chalin03-Branch-Code"] = String(branchCode);
  if (branchName) config.headers["X-Chalin03-Branch-Name"] = String(branchName);
  return applyFinanceApplicationDeadline(config);
});

axiosClient.interceptors.response.use(
  (response) => {
    const requestUrl = String(response.config?.url || "").replace(/\?.*$/, "");
    if (/\/equipment-catalogue\/sales\/agreements\/\d+$/.test(requestUrl) && response.data && typeof response.data === "object") {
      response.data.delivery = response.data.delivery || response.data.deliveries?.[0] || null;
      response.data.ownership = response.data.ownership || response.data.ownership_transfers?.[0] || null;
    }
    return response;
  },
  (error) => {
    const statusCode = error.response?.status;
    const errorCode = String(error.response?.data?.code || "");
    const errorMessage = String(error.response?.data?.message || "");
    const requestUrl = String(error.config?.url || "");
    const requestPath = cleanRequestPath(requestUrl);
    const requestToken = String(error.config?.[REQUEST_TOKEN_KEY] || "");
    const activeToken = String(localStorage.getItem(TOKEN_KEY) || "");
    const cachedUser = getStoredUser();
    const isOwnerRecoveryRequest = requestUrl.includes("/release2-final/owner/");
    const isOwnerRecoveryPage = window.location.pathname === "/owner-recovery";
    const isStaleSessionResponse = statusCode === 401 && Boolean(requestToken) && Boolean(activeToken) && requestToken !== activeToken;
    const isChangePasswordCredentialFailure = requestPath === "/auth/change-password" && statusCode === 401 && (errorCode === "CURRENT_PASSWORD_INCORRECT" || errorMessage === "Current password is incorrect.");
    const isTemporaryProfileFailure = requestPath === "/auth/me" && Boolean(activeToken) && requestToken === activeToken && Boolean(cachedUser) && (statusCode === undefined || statusCode === 0 || statusCode === 400 || statusCode >= 500);
    if (isStaleSessionResponse) {
      const alreadyRetried = Boolean(error.config?.[STALE_SESSION_RETRY_KEY]);
      const requestWasAborted = Boolean(error.config?.signal?.aborted);
      if (!alreadyRetried && !requestWasAborted) return axiosClient.request({ ...error.config, [STALE_SESSION_RETRY_KEY]: true, [REQUEST_TOKEN_KEY]: activeToken, headers: { ...(error.config?.headers || {}), Authorization: `Bearer ${activeToken}` } });
      return Promise.reject(new axios.CanceledError("A stale authenticated request was replaced by the current session."));
    }
    if (isTemporaryProfileFailure) {
      try { sessionStorage.setItem("chalin03_session_warning", errorMessage || "Fresh profile details could not be loaded. Your verified session remains active."); } catch { /* Session storage may be unavailable; keep the verified session active. */ }
      return Promise.resolve(buildCachedProfileResponse(error, cachedUser));
    }
    if (statusCode === 401 && !isOwnerRecoveryRequest && !isOwnerRecoveryPage && !isChangePasswordCredentialFailure) {
      if (errorCode === "SESSION_REPLACED") sessionStorage.setItem("chalin03_login_notice", errorMessage || "Your account was signed in on another device.");
      else if (errorCode.startsWith("SESSION_EXPIRED")) sessionStorage.setItem("chalin03_login_notice", errorMessage || "Your session ended after 8 hours or at 12:00 a.m. Ghana time. Please login again.");
      if (!requestToken || requestToken === activeToken) { clearStoredSession(); clearPollingReadCache(); if (window.location.pathname !== "/login") window.location.href = "/login"; }
    }
    return Promise.reject(error);
  }
);

// Collapse repeated polling calls before they reach Railway. Mutations clear their
// matching cache immediately, so user actions still refresh with fresh server data.
const uncachedGet = axiosClient.get.bind(axiosClient);
axiosClient.get = async function chalinCachedGet(url, config = {}) {
  const ttl = pollingReadTtl(url);
  if (!ttl || config.__skipChalinReadCache === true) {
    return uncachedGet(url, config);
  }

  const key = pollingReadKey(url, config);
  const cached = pollingReadCache.get(key);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return {
      ...cached.response,
      data: clonePollingValue(cached.response.data),
      config: { ...(cached.response.config || {}), ...config, url },
      request: null,
    };
  }
  if (cached) pollingReadCache.delete(key);

  const existing = pollingReadInFlight.get(key);
  if (existing) return existing;

  const request = uncachedGet(url, config)
    .then((response) => {
      if (response.status >= 200 && response.status < 300) {
        pollingReadCache.set(key, {
          expiresAt: Date.now() + ttl,
          response: {
            data: clonePollingValue(response.data),
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            config: response.config,
          },
        });
      }
      return response;
    })
    .finally(() => pollingReadInFlight.delete(key));

  pollingReadInFlight.set(key, request);
  return request;
};

if (typeof window !== "undefined") {
  window.addEventListener("storage", () => clearPollingReadCache());
  window.addEventListener("chalin03:approval-request-changed", () => {
    clearPollingReadCache("/audit-unlock-requests/operational");
  });
}

export default axiosClient;
