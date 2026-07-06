import { createContext, useContext, useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";

const AuthContext = createContext(null);

const TOKEN_KEY = "chalin03_token";
const USER_KEY = "chalin03_user";

function safeParseUser(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    localStorage.removeItem(USER_KEY);
    return null;
  }
}

function toNumberOrNull(value) {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    return null;
  }

  return number;
}

function normalizeBranch(rawBranch, fallbackUser = null) {
  const branchId = toNumberOrNull(
    rawBranch?.id ||
      rawBranch?.branch_id ||
      fallbackUser?.branch_id ||
      fallbackUser?.default_branch_id
  );

  if (!branchId) {
    return null;
  }

  const branchCode =
    rawBranch?.code ||
    rawBranch?.branch_code ||
    fallbackUser?.branch_code ||
    "";

  const branchName =
    rawBranch?.name ||
    rawBranch?.branch_name ||
    fallbackUser?.branch_name ||
    "";

  const branchLocation =
    rawBranch?.location ||
    rawBranch?.branch_location ||
    fallbackUser?.branch_location ||
    "";

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
  if (!rawUser) {
    return null;
  }

  const selectedBranch = normalizeBranch(rawUser.selected_branch, rawUser);

  const userBranches = Array.isArray(rawUser.branches)
    ? rawUser.branches.map((branch) => normalizeBranch(branch)).filter(Boolean)
    : Array.isArray(rawUser.accessible_branches)
    ? rawUser.accessible_branches
        .map((branch) => normalizeBranch(branch))
        .filter(Boolean)
    : [];

  const branchId =
    selectedBranch?.id ||
    toNumberOrNull(rawUser.branch_id) ||
    toNumberOrNull(rawUser.default_branch_id);

  return {
    ...rawUser,
    role: String(rawUser.role || "").toLowerCase(),
    branch_id: branchId,
    default_branch_id: toNumberOrNull(rawUser.default_branch_id) || branchId,
    branch_code:
      rawUser.branch_code ||
      selectedBranch?.branch_code ||
      selectedBranch?.code ||
      "",
    branch_name:
      rawUser.branch_name ||
      selectedBranch?.branch_name ||
      selectedBranch?.name ||
      "",
    branch_location:
      rawUser.branch_location ||
      selectedBranch?.branch_location ||
      selectedBranch?.location ||
      "",
    selected_branch: selectedBranch,
    branches: userBranches,
    can_access_all_branches: Boolean(rawUser.can_access_all_branches),
  };
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));

  const [user, setUser] = useState(() =>
    normalizeUser(safeParseUser(localStorage.getItem(USER_KEY)))
  );

  const [loading, setLoading] = useState(() =>
    Boolean(localStorage.getItem(TOKEN_KEY))
  );

  function saveSession(newToken, newUser) {
    const normalizedUser = normalizeUser(newUser);

    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(normalizedUser));

    setToken(newToken);
    setUser(normalizedUser);
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);

    setToken(null);
    setUser(null);
    setLoading(false);
  }

  async function login(username, password, branchId) {
    const cleanBranchId = toNumberOrNull(branchId);

    if (!cleanBranchId) {
      throw new Error("Please choose a store before logging in.");
    }

    const response = await axiosClient.post("/auth/login", {
      username,
      password,
      branch_id: cleanBranchId,
    });

    saveSession(response.data.token, response.data.user);

    return response.data;
  }

  async function refreshUser() {
    const savedToken = localStorage.getItem(TOKEN_KEY);

    if (!savedToken) {
      logout();
      return;
    }

    setLoading(true);

    try {
      const response = await axiosClient.get("/auth/me");
      const freshUser = normalizeUser(response.data.user);

      if (!freshUser) {
        logout();
        return;
      }

      localStorage.setItem(USER_KEY, JSON.stringify(freshUser));
      setToken(savedToken);
      setUser(freshUser);
    } catch {
      logout();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) {
      refreshUser();
      return;
    }

    setLoading(false);
    // We only want this to run once when the app opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const authValue = useMemo(() => {
    const role = String(user?.role || "").toLowerCase();

    const selectedBranch = normalizeBranch(user?.selected_branch, user);
    const branchId =
      selectedBranch?.id ||
      toNumberOrNull(user?.branch_id) ||
      toNumberOrNull(user?.default_branch_id);

    const branchCode =
      user?.branch_code ||
      selectedBranch?.branch_code ||
      selectedBranch?.code ||
      "";

    const branchName =
      user?.branch_name ||
      selectedBranch?.branch_name ||
      selectedBranch?.name ||
      "";

    const branchLocation =
      user?.branch_location ||
      selectedBranch?.branch_location ||
      selectedBranch?.location ||
      "";

    const userBranches = Array.isArray(user?.branches) ? user.branches : [];

    return {
      token,
      user,
      role,
      loading,
      isLoggedIn: Boolean(token && user),

      selectedBranch,
      branchId,
      branchCode,
      branchName,
      branchLocation,
      userBranches,
      canAccessAllBranches: Boolean(user?.can_access_all_branches),
      hasSelectedBranch: Boolean(branchId),

      login,
      logout,
      refreshUser,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user, loading]);

  return (
    <AuthContext.Provider value={authValue}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }

  return context;
}