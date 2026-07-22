import axios from "axios";
import "../utils/equipmentMediaCaptureBridge";

const axiosClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000/api",
  timeout: 30000,
});

function getStoredUser() {
  try {
    const storedUser = localStorage.getItem("chalin03_user");

    if (!storedUser) {
      return null;
    }

    return JSON.parse(storedUser);
  } catch {
    return null;
  }
}


function getStoredWorkspaceContextId(workspaceCode) {
  const keyMap = {
    mining: "chalin03_active_context_mining",
    equipment_hire: "chalin03_active_context_equipment_hire",
  };
  const key = keyMap[workspaceCode];

  if (!key) return "";

  const value = Number(localStorage.getItem(key));
  return Number.isInteger(value) && value > 0 ? String(value) : "";
}

function getStoredSessionInfo() {
  const user = getStoredUser();

  const workspaceCode =
    user?.workspace_code || user?.active_workspace?.code || "spare_parts";

  const isSparePartsWorkspace = workspaceCode === "spare_parts";

  const branchId = isSparePartsWorkspace
    ? user?.branch_id ||
      user?.default_branch_id ||
      user?.selected_branch?.id ||
      user?.selected_branch?.branch_id ||
      ""
    : "";

  const branchCode = isSparePartsWorkspace
    ? user?.branch_code ||
      user?.code ||
      user?.selected_branch?.branch_code ||
      user?.selected_branch?.code ||
      ""
    : "";

  const branchName = isSparePartsWorkspace
    ? user?.branch_name ||
      user?.name ||
      user?.selected_branch?.branch_name ||
      user?.selected_branch?.name ||
      ""
    : "";

  return {
    workspaceCode,
    branchId,
    branchCode,
    branchName,
  };
}

axiosClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("chalin03_token");
  const { workspaceCode, branchId, branchCode, branchName } =
    getStoredSessionInfo();
  const workspaceContextId = getStoredWorkspaceContextId(workspaceCode);

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  if (workspaceCode) {
    config.headers["X-Chalin03-Workspace"] = String(workspaceCode);
  }

  if (workspaceContextId) {
    config.headers["X-Chalin03-Context-Id"] = workspaceContextId;
  }

  // Branch headers are sent only for the Spare Parts workspace.
  if (branchId) {
    config.headers["X-Chalin03-Branch-Id"] = String(branchId);
  }

  if (branchCode) {
    config.headers["X-Chalin03-Branch-Code"] = String(branchCode);
  }

  if (branchName) {
    config.headers["X-Chalin03-Branch-Name"] = String(branchName);
  }

  return config;
});

axiosClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const statusCode = error.response?.status;
    const errorCode = String(error.response?.data?.code || "");
    const errorMessage = String(error.response?.data?.message || "");
    const requestUrl = String(error.config?.url || "");
    const isOwnerRecoveryRequest = requestUrl.includes(
      "/release2-final/owner/"
    );
    const isOwnerRecoveryPage = window.location.pathname === "/owner-recovery";

    if (statusCode === 401 && !isOwnerRecoveryRequest && !isOwnerRecoveryPage) {
      if (errorCode === "SESSION_REPLACED") {
        sessionStorage.setItem(
          "chalin03_login_notice",
          errorMessage || "Your account was signed in on another device."
        );
      }

      localStorage.removeItem("chalin03_token");
      localStorage.removeItem("chalin03_user");
      localStorage.removeItem("chalin03_active_context_mining");
      localStorage.removeItem("chalin03_active_context_equipment_hire");

      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }

    return Promise.reject(error);
  }
);

export default axiosClient;
