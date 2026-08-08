import { createContext, useContext, useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import {
  hasAnyPermission as permissionListHasAny,
  hasEveryPermission as permissionListHasEvery,
  hasPermission as permissionListHasOne,
} from "../security/permissionRules";
import { installSessionExpiryGuard } from "../security/sessionExpiryGuard";

const AuthContext = createContext(null);

const TOKEN_KEY = "chalin03_token";
const USER_KEY = "chalin03_user";
const DEFAULT_WORKSPACE_CODE = "spare_parts";
const CONTENT_STUDIO_WORKSPACE_CODE = "content_studio";
const WORKSPACE_CODES = new Set([
  "spare_parts",
  "mining",
  "equipment_hire",
  CONTENT_STUDIO_WORKSPACE_CODE,
]);

function safeParseUser(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    localStorage.removeItem(USER_KEY);
    return null;
  }
}

function toNumberOrNull(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return null;
  return number;
}

function normalizeWorkspaceCode(value) {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (!cleaned) return DEFAULT_WORKSPACE_CODE;
  if (cleaned === "hire" || cleaned === "equipment") return "equipment_hire";
  return WORKSPACE_CODES.has(cleaned) ? cleaned : DEFAULT_WORKSPACE_CODE;
}

function normalizeBranch(rawBranch, fallbackUser = null) {
  const branchId = toNumberOrNull(
    rawBranch?.id ||
      rawBranch?.branch_id ||
      fallbackUser?.branch_id ||
      fallbackUser?.default_branch_id
  );
  if (!branchId) return null;

  const branchCode =
    rawBranch?.code || rawBranch?.branch_code || fallbackUser?.branch_code || "";
  const branchName =
    rawBranch?.name || rawBranch?.branch_name || fallbackUser?.branch_name || "";
  const branchLocation =
    rawBranch?.location || rawBranch?.branch_location || fallbackUser?.branch_location || "";

  return {
    id: branchId,
    branch_id: branchId,
    code: branchCode,
    branch_code: branchCode,
    name: branchName,
    branch_name: branchName,
    location: branchLocation,
    branch_location: branchLocation,
  };
}

function normalizeUser(rawUser) {
  if (!rawUser) return null;

  const workspaceCode = normalizeWorkspaceCode(
    rawUser.workspace_code || rawUser.active_workspace?.code
  );
  const isSparePartsWorkspace = workspaceCode === DEFAULT_WORKSPACE_CODE;

  const selectedBranch = isSparePartsWorkspace
    ? normalizeBranch(rawUser.selected_branch, rawUser)
    : null;

  const userBranches = isSparePartsWorkspace
    ? Array.isArray(rawUser.branches)
      ? rawUser.branches.map((branch) => normalizeBranch(branch)).filter(Boolean)
      : Array.isArray(rawUser.accessible_branches)
      ? rawUser.accessible_branches
          .map((branch) => normalizeBranch(branch))
          .filter(Boolean)
      : []
    : [];

  const branchId = isSparePartsWorkspace
    ? selectedBranch?.id ||
      toNumberOrNull(rawUser.branch_id) ||
      toNumberOrNull(rawUser.default_branch_id)
    : null;

  const workspaceName =
    rawUser.business_unit_name ||
    rawUser.active_workspace?.name ||
    (workspaceCode === "mining"
      ? "Mining Operations"
      : workspaceCode === "equipment_hire"
      ? "Equipment Hire"
      : workspaceCode === CONTENT_STUDIO_WORKSPACE_CODE
      ? "Content Studio"
      : "Spare Parts");

  return {
    ...rawUser,
    role: String(rawUser.role || "").toLowerCase(),
    workspace_code: workspaceCode,
    business_unit_id: toNumberOrNull(rawUser.business_unit_id),
    business_unit_name: workspaceName,
    active_workspace: {
      id:
        toNumberOrNull(rawUser.active_workspace?.id) ||
        toNumberOrNull(rawUser.business_unit_id),
      code: workspaceCode,
      name: workspaceName,
    },
    branch_id: branchId,
    default_branch_id: isSparePartsWorkspace
      ? toNumberOrNull(rawUser.default_branch_id) || branchId
      : null,
    branch_code: isSparePartsWorkspace
      ? rawUser.branch_code || selectedBranch?.branch_code || selectedBranch?.code || ""
      : "",
    branch_name: isSparePartsWorkspace
      ? rawUser.branch_name || selectedBranch?.branch_name || selectedBranch?.name || ""
      : "",
    branch_location: isSparePartsWorkspace
      ? rawUser.branch_location ||
        selectedBranch?.branch_location ||
        selectedBranch?.location ||
        ""
      : "",
    selected_branch: selectedBranch,
    branches: userBranches,
    can_access_all_branches: isSparePartsWorkspace
      ? Boolean(rawUser.can_access_all_branches)
      : false,
    must_change_password: Boolean(rawUser.must_change_password),
    password_changed_at: rawUser.password_changed_at || null,
    workspace_role: String(
      rawUser.workspace_role || rawUser.access_role || rawUser.role || ""
    )
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_"),
    effective_permissions: Array.isArray(rawUser.effective_permissions)
      ? rawUser.effective_permissions
      : [],
    content_studio_scopes: Array.isArray(rawUser.content_studio_scopes)
      ? rawUser.content_studio_scopes
      : [],
  };
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(() =>
    normalizeUser(safeParseUser(localStorage.getItem(USER_KEY)))
  );
  const [loading, setLoading] = useState(() => Boolean(localStorage.getItem(TOKEN_KEY)));

  function adoptLatestStoredSession() {
    const latestToken = localStorage.getItem(TOKEN_KEY);
    const latestUser = normalizeUser(safeParseUser(localStorage.getItem(USER_KEY)));
    setToken(latestToken || null);
    setUser(latestToken ? latestUser : null);
    setLoading(false);
    return Boolean(latestToken && latestUser);
  }

  function saveSession(newToken, newUser) {
    const normalizedUser = normalizeUser(newUser);
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(normalizedUser));
    setToken(newToken);
    setUser(normalizedUser);
  }

  async function logout({ expectedToken = null } = {}) {
    const tokenBeforeLogout = localStorage.getItem(TOKEN_KEY);
    if (expectedToken && tokenBeforeLogout && tokenBeforeLogout !== expectedToken) {
      adoptLatestStoredSession();
      return false;
    }

    let preservedNewerSession;
    try {
      if (tokenBeforeLogout) await axiosClient.post("/auth/logout");
    } catch {
      // Local logout must still complete when the server session already ended.
    } finally {
      const tokenAfterRequest = localStorage.getItem(TOKEN_KEY);
      preservedNewerSession = Boolean(
        expectedToken && tokenAfterRequest && tokenAfterRequest !== expectedToken
      );

      if (preservedNewerSession) {
        adoptLatestStoredSession();
      } else {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem("chalin03_active_context_mining");
        localStorage.removeItem("chalin03_active_context_equipment_hire");
        setToken(null);
        setUser(null);
        setLoading(false);
      }
    }
    return !preservedNewerSession;
  }

  async function login(credentialsOrUsername, password, branchId) {
    const credentials =
      typeof credentialsOrUsername === "object" && credentialsOrUsername !== null
        ? credentialsOrUsername
        : {
            username: credentialsOrUsername,
            password,
            branchId,
            workspaceCode: DEFAULT_WORKSPACE_CODE,
          };

    const workspaceCode = normalizeWorkspaceCode(credentials.workspaceCode);
    const cleanBranchId = toNumberOrNull(credentials.branchId);

    if (workspaceCode === DEFAULT_WORKSPACE_CODE && !cleanBranchId) {
      throw new Error("Please choose a Spare Parts store before logging in.");
    }

    const identifier = String(credentials.identifier || credentials.username || "").trim();
    const isContentStudio = workspaceCode === CONTENT_STUDIO_WORKSPACE_CODE;
    const endpoint = isContentStudio ? "/content-studio-auth/login" : "/auth/login";
    const payload = isContentStudio
      ? {
          identifier,
          username: identifier,
          password: credentials.password,
          device_evidence: credentials.deviceEvidence || {},
        }
      : {
          identifier,
          username: identifier,
          password: credentials.password,
          workspace_code: workspaceCode,
          branch_id: workspaceCode === DEFAULT_WORKSPACE_CODE ? cleanBranchId : null,
          device_evidence: credentials.deviceEvidence || {},
        };

    const response = await axiosClient.post(endpoint, payload);
    const responseUser = {
      ...response.data.user,
      workspace_code:
        response.data.user?.workspace_code ||
        response.data.workspace?.code ||
        workspaceCode,
      active_workspace:
        response.data.user?.active_workspace || response.data.workspace,
    };

    saveSession(response.data.token, responseUser);
    return { ...response.data, user: normalizeUser(responseUser) };
  }

  async function refreshUser() {
    const refreshToken = localStorage.getItem(TOKEN_KEY);
    if (!refreshToken) {
      setToken(null);
      setUser(null);
      setLoading(false);
      return;
    }

    const storedUser = normalizeUser(safeParseUser(localStorage.getItem(USER_KEY)));
    const refreshEndpoint =
      storedUser?.workspace_code === CONTENT_STUDIO_WORKSPACE_CODE
        ? "/content-studio-auth/me"
        : "/auth/me";

    setLoading(true);
    try {
      const response = await axiosClient.get(refreshEndpoint);
      const activeToken = localStorage.getItem(TOKEN_KEY);
      if (activeToken && activeToken !== refreshToken) {
        adoptLatestStoredSession();
        return;
      }

      const freshUser = normalizeUser({
        ...response.data.user,
        workspace_code:
          response.data.user?.workspace_code || response.data.workspace?.code,
        active_workspace:
          response.data.user?.active_workspace || response.data.workspace,
      });

      if (!freshUser) {
        await logout({ expectedToken: refreshToken });
        return;
      }

      localStorage.setItem(USER_KEY, JSON.stringify(freshUser));
      setToken(refreshToken);
      setUser(freshUser);
    } catch {
      const activeToken = localStorage.getItem(TOKEN_KEY);
      if (activeToken && activeToken !== refreshToken) {
        adoptLatestStoredSession();
        return;
      }
      await logout({ expectedToken: refreshToken });
    } finally {
      const activeToken = localStorage.getItem(TOKEN_KEY);
      if (!activeToken || activeToken === refreshToken) setLoading(false);
    }
  }

  useEffect(() => {
    if (token) {
      refreshUser();
      return;
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!token) return undefined;
    return installSessionExpiryGuard({
      token,
      onExpire() {
        setToken(null);
        setUser(null);
        setLoading(false);
      },
    });
  }, [token]);

  const authValue = useMemo(() => {
    const role = String(user?.role || "").toLowerCase();
    const workspaceCode = normalizeWorkspaceCode(user?.workspace_code);
    const isSparePartsWorkspace = workspaceCode === DEFAULT_WORKSPACE_CODE;
    const isMiningWorkspace = workspaceCode === "mining";
    const isEquipmentHireWorkspace = workspaceCode === "equipment_hire";
    const isContentStudioWorkspace = workspaceCode === CONTENT_STUDIO_WORKSPACE_CODE;
    const workspaceRole = String(
      user?.workspace_role || user?.access_role || role || ""
    )
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");

    const selectedBranch = isSparePartsWorkspace
      ? normalizeBranch(user?.selected_branch, user)
      : null;
    const branchId = isSparePartsWorkspace
      ? selectedBranch?.id ||
        toNumberOrNull(user?.branch_id) ||
        toNumberOrNull(user?.default_branch_id)
      : null;

    const branchCode = isSparePartsWorkspace
      ? user?.branch_code || selectedBranch?.branch_code || selectedBranch?.code || ""
      : "";
    const branchName = isSparePartsWorkspace
      ? user?.branch_name || selectedBranch?.branch_name || selectedBranch?.name || ""
      : "";
    const branchLocation = isSparePartsWorkspace
      ? user?.branch_location ||
        selectedBranch?.branch_location ||
        selectedBranch?.location ||
        ""
      : "";
    const userBranches = isSparePartsWorkspace && Array.isArray(user?.branches)
      ? user.branches
      : [];

    return {
      token,
      user,
      role,
      loading,
      isLoggedIn: Boolean(token && user),
      workspaceCode,
      workspaceName: user?.business_unit_name || user?.active_workspace?.name || "",
      activeWorkspace: user?.active_workspace || null,
      workspaceRole,
      isSparePartsWorkspace,
      isMiningWorkspace,
      isEquipmentHireWorkspace,
      isContentStudioWorkspace,
      contentStudioRole: user?.content_studio_role || (isContentStudioWorkspace ? workspaceRole : ""),
      contentStudioRoleName: user?.content_studio_role_name || "",
      contentStudioScopes: Array.isArray(user?.content_studio_scopes)
        ? user.content_studio_scopes
        : [],
      isContentStudioOwner: Boolean(user?.is_content_studio_owner),

      selectedBranch,
      branchId,
      branchCode,
      branchName,
      branchLocation,
      userBranches,
      canAccessAllBranches:
        isSparePartsWorkspace && Boolean(user?.can_access_all_branches),
      hasSelectedBranch: isSparePartsWorkspace ? Boolean(branchId) : false,
      mustChangePassword: Boolean(user?.must_change_password),
      effectivePermissions: Array.isArray(user?.effective_permissions)
        ? user.effective_permissions
        : [],
      hasPermission(permission) {
        return permissionListHasOne(user?.effective_permissions, permission);
      },
      hasEveryPermission(permissions) {
        return permissionListHasEvery(user?.effective_permissions, permissions);
      },
      hasAnyPermission(permissions) {
        return permissionListHasAny(user?.effective_permissions, permissions);
      },

      login,
      logout,
      refreshUser,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user, loading]);

  return <AuthContext.Provider value={authValue}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
