import axios from "axios";

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

function getStoredBranchInfo() {
  const user = getStoredUser();

  const branchId =
    user?.branch_id ||
    user?.default_branch_id ||
    user?.selected_branch?.id ||
    user?.selected_branch?.branch_id ||
    "";

  const branchCode =
    user?.branch_code ||
    user?.code ||
    user?.selected_branch?.branch_code ||
    user?.selected_branch?.code ||
    "";

  const branchName =
    user?.branch_name ||
    user?.name ||
    user?.selected_branch?.branch_name ||
    user?.selected_branch?.name ||
    "";

  return {
    branchId,
    branchCode,
    branchName,
  };
}

axiosClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("chalin03_token");
  const { branchId, branchCode, branchName } = getStoredBranchInfo();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  /*
    The backend mainly trusts the JWT token for branch/store separation.
    These extra headers help debugging and are safe for future backend support.
  */
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

    if (statusCode === 401) {
      localStorage.removeItem("chalin03_token");
      localStorage.removeItem("chalin03_user");

      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }

    return Promise.reject(error);
  }
);

export default axiosClient;
