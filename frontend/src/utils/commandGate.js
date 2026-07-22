import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const STATION_KEY_PREFIX = "chalin03_station_mode_";
const LAST_WORK_KEY_PREFIX = "chalin03_last_work_";

const WORKSPACE_PREFIXES = {
  spare_parts: ["/"],
  mining: ["/mining"],
  equipment_hire: ["/equipment-hire-operations"],
};

export const stationModes = {
  spare_parts: [
    {
      code: "auto",
      title: "Smart entrance",
      description: "Resume work or open the best page for your role.",
      icon: "✦",
    },
    {
      code: "sales",
      title: "Sales station",
      description: "Open New Sale immediately after login.",
      icon: "🛒",
      path: "/new-sale",
    },
    {
      code: "stock",
      title: "Stock station",
      description: "Open products and inventory operations.",
      icon: "📦",
      path: "/products",
    },
    {
      code: "closing",
      title: "Closing station",
      description: "Open Daily Closing for management.",
      icon: "🌙",
      path: "/daily-closing",
    },
  ],
  mining: [
    {
      code: "auto",
      title: "Smart entrance",
      description: "Resume work or open the best page for your role.",
      icon: "✦",
    },
    {
      code: "shift",
      title: "Mining shift",
      description: "Open Daily Site Logs immediately.",
      icon: "📝",
      path: "/mining/daily-logs",
    },
    {
      code: "fuel",
      title: "Fuel station",
      description: "Open Fuel Management immediately.",
      icon: "⛽",
      path: "/mining/fuel",
    },
    {
      code: "equipment",
      title: "Equipment station",
      description: "Open machine hours and downtime.",
      icon: "🚜",
      path: "/mining/equipment",
    },
  ],
  equipment_hire: [
    {
      code: "auto",
      title: "Smart entrance",
      description: "Resume work or open the best page for your role.",
      icon: "✦",
    },
    {
      code: "dispatch",
      title: "Dispatch station",
      description: "Open Dispatch and Job Cards immediately.",
      icon: "🚚",
      path: "/equipment-hire-operations/operations",
    },
    {
      code: "finance",
      title: "Finance station",
      description: "Open invoices and payments immediately.",
      icon: "💰",
      path: "/equipment-hire-operations/finance",
    },
    {
      code: "returns",
      title: "Return station",
      description: "Open return inspections immediately.",
      icon: "🔍",
      path: "/equipment-hire-operations/returns",
    },
  ],
};

function getToken() {
  return localStorage.getItem("chalin03_token") || "";
}

function jsonHeaders({ authenticated = false } = {}) {
  const headers = {
    "Content-Type": "application/json",
  };

  if (authenticated && getToken()) {
    headers.Authorization = `Bearer ${getToken()}`;
  }

  return headers;
}

async function parseApiResponse(response) {
  let body = {};

  try {
    body = await response.json();
  } catch {
    body = {};
  }

  if (!response.ok) {
    const error = new Error(
      body.message || "The Command Gate request could not be completed."
    );
    error.response = {
      status: response.status,
      data: body,
    };
    throw error;
  }

  return body;
}

export function supportsPasskeys() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    browserSupportsWebAuthn()
  );
}

export async function authenticateWithPasskey({
  workspaceCode,
  branchId,
  collectDeviceEvidence,
}) {
  const optionsResponse = await fetch(
    `${API_BASE_URL}/auth/passkeys/authentication/options`,
    {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        workspace_code: workspaceCode,
        branch_id: workspaceCode === "spare_parts" ? Number(branchId) : null,
      }),
    }
  );

  const optionsBody = await parseApiResponse(optionsResponse);
  const credentialResponse = await startAuthentication({
    optionsJSON: optionsBody.options,
  });

  const deviceEvidence =
    typeof collectDeviceEvidence === "function"
      ? await collectDeviceEvidence()
      : {};

  const verifyResponse = await fetch(
    `${API_BASE_URL}/auth/passkeys/authentication/verify`,
    {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        challenge_id: optionsBody.challenge_id,
        response: credentialResponse,
        device_evidence: deviceEvidence,
      }),
    }
  );

  return parseApiResponse(verifyResponse);
}

export async function registerPasskey({
  currentPassword,
  displayName,
}) {
  const optionsResponse = await fetch(
    `${API_BASE_URL}/auth/passkeys/registration/options`,
    {
      method: "POST",
      headers: jsonHeaders({ authenticated: true }),
      body: JSON.stringify({
        current_password: currentPassword,
        display_name: displayName,
      }),
    }
  );

  const optionsBody = await parseApiResponse(optionsResponse);
  const credentialResponse = await startRegistration({
    optionsJSON: optionsBody.options,
  });

  const verifyResponse = await fetch(
    `${API_BASE_URL}/auth/passkeys/registration/verify`,
    {
      method: "POST",
      headers: jsonHeaders({ authenticated: true }),
      body: JSON.stringify({
        challenge_id: optionsBody.challenge_id,
        response: credentialResponse,
      }),
    }
  );

  return parseApiResponse(verifyResponse);
}

export function getStationModes(workspaceCode) {
  return stationModes[workspaceCode] || stationModes.spare_parts;
}

export function getSavedStationMode(workspaceCode) {
  return (
    localStorage.getItem(`${STATION_KEY_PREFIX}${workspaceCode}`) || "auto"
  );
}

export function saveStationMode(workspaceCode, stationCode) {
  const available = getStationModes(workspaceCode);
  const valid = available.some((station) => station.code === stationCode);
  const nextCode = valid ? stationCode : "auto";

  localStorage.setItem(`${STATION_KEY_PREFIX}${workspaceCode}`, nextCode);
  return nextCode;
}

export function saveLastWork(workspaceCode, pathname) {
  const cleanPath = String(pathname || "").trim();

  if (!cleanPath || cleanPath === "/login") {
    return;
  }

  localStorage.setItem(`${LAST_WORK_KEY_PREFIX}${workspaceCode}`, cleanPath);
}

export function getLastWork(workspaceCode) {
  const path = localStorage.getItem(`${LAST_WORK_KEY_PREFIX}${workspaceCode}`);

  return isWorkspacePath(workspaceCode, path) ? path : "";
}

export function isWorkspacePath(workspaceCode, path) {
  const cleanPath = String(path || "");

  if (!cleanPath || cleanPath === "/login") {
    return false;
  }

  if (workspaceCode === "spare_parts") {
    return (
      cleanPath.startsWith("/") &&
      !cleanPath.startsWith("/mining") &&
      !cleanPath.startsWith("/equipment-hire-operations") &&
      !cleanPath.startsWith("/owner-recovery")
    );
  }

  return (WORKSPACE_PREFIXES[workspaceCode] || []).some(
    (prefix) => cleanPath === prefix || cleanPath.startsWith(`${prefix}/`)
  );
}

function hasPermission(user, permission) {
  return Array.isArray(user?.effective_permissions)
    ? user.effective_permissions.includes(permission)
    : false;
}

export function getRoleDefaultDestination(user, workspaceCode) {
  const role = String(user?.workspace_role || user?.role || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (workspaceCode === "mining") {
    if (
      role === "operator" ||
      role === "supervisor" ||
      hasPermission(user, "mining.daily_logs.view")
    ) {
      return "/mining/daily-logs";
    }

    if (role === "accountant" && hasPermission(user, "mining.expenses.view")) {
      return "/mining/expenses";
    }

    if (role === "auditor") {
      return "/mining/shared-controls";
    }

    return "/mining";
  }

  if (workspaceCode === "equipment_hire") {
    if (
      role === "operator" ||
      role === "supervisor" ||
      hasPermission(user, "hire.dispatch.view")
    ) {
      return "/equipment-hire-operations/operations";
    }

    if (
      role === "accountant" ||
      hasPermission(user, "hire.invoices.view") ||
      hasPermission(user, "hire.payments.view")
    ) {
      return "/equipment-hire-operations/finance";
    }

    if (role === "auditor") {
      return "/equipment-hire-operations/shared-controls";
    }

    return "/equipment-hire-operations";
  }

  if (role === "cashier") {
    return "/new-sale";
  }

  if (role === "auditor") {
    return "/audit-accounting";
  }

  return "/";
}

function canOpenStation(user, workspaceCode, stationCode) {
  const role = String(user?.workspace_role || user?.role || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (stationCode === "auto") return true;

  if (workspaceCode === "spare_parts") {
    if (stationCode === "closing") {
      return role === "admin" || role === "manager";
    }

    return ["admin", "manager", "cashier"].includes(role);
  }

  if (workspaceCode === "mining") {
    const permissionMap = {
      shift: "mining.daily_logs.view",
      fuel: "mining.fuel.view",
      equipment: "mining.equipment_logs.view",
    };

    return (
      role === "admin" ||
      role === "manager" ||
      hasPermission(user, permissionMap[stationCode])
    );
  }

  if (workspaceCode === "equipment_hire") {
    const permissionMap = {
      dispatch: "hire.dispatch.view",
      finance: "hire.invoices.view",
      returns: "hire.returns.view",
    };

    return (
      role === "admin" ||
      role === "manager" ||
      hasPermission(user, permissionMap[stationCode])
    );
  }

  return false;
}

export function getPostLoginDestination({
  user,
  workspaceCode,
  stationCode,
  preferResume = true,
}) {
  const station = getStationModes(workspaceCode).find(
    (item) => item.code === stationCode
  );

  if (station?.path && canOpenStation(user, workspaceCode, stationCode)) {
    return station.path;
  }

  const resumePath = preferResume ? getLastWork(workspaceCode) : "";

  return resumePath || getRoleDefaultDestination(user, workspaceCode);
}

export function describeResumePath(path) {
  const labels = {
    "/": "Spare Parts Dashboard",
    "/new-sale": "New Sale",
    "/products": "Products & Stock",
    "/daily-closing": "Daily Closing",
    "/mining": "Mining Dashboard",
    "/mining/daily-logs": "Mining Daily Site Logs",
    "/mining/fuel": "Mining Fuel Management",
    "/mining/equipment": "Mining Equipment Operations",
    "/equipment-hire-operations": "Equipment Hire Dashboard",
    "/equipment-hire-operations/operations": "Dispatch & Job Cards",
    "/equipment-hire-operations/finance": "Invoices & Payments",
    "/equipment-hire-operations/returns": "Return Inspections",
  };

  return labels[path] || "Previous work";
}
