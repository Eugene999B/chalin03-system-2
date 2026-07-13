import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function RoleRoute({ allowedRoles = [], children }) {
  const {
    user,
    role,
    workspaceCode,
    workspaceName,
    isSparePartsWorkspace,
    branchCode,
    branchName,
    branchLocation,
  } = useAuth();

  const currentRole = String(role || user?.role || "").toLowerCase();
  const allowed = allowedRoles.map((item) => String(item || "").toLowerCase());

  const currentStoreCode =
    branchCode ||
    user?.branch_code ||
    user?.selected_branch?.branch_code ||
    user?.selected_branch?.code ||
    "STORE";

  const currentStoreName =
    branchName ||
    user?.branch_name ||
    user?.selected_branch?.branch_name ||
    user?.selected_branch?.name ||
    "Selected Store";

  const currentStoreLocation =
    branchLocation ||
    user?.branch_location ||
    user?.selected_branch?.branch_location ||
    user?.selected_branch?.location ||
    "";

  const accessContext = isSparePartsWorkspace
    ? `${currentStoreCode} — ${currentStoreName}`
    : workspaceName ||
      (workspaceCode === "mining"
        ? "Mining Operations"
        : workspaceCode === "equipment_hire"
        ? "Equipment Hire"
        : "this workspace");

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!allowed.includes(currentRole)) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Access Denied</h1>
            <p>You are not allowed to open this page in {accessContext}.</p>
          </div>
        </div>

        <div className="error-box">
          Your account does not have permission to perform this action.
          {isSparePartsWorkspace && currentStoreLocation
            ? ` Selected store: ${currentStoreLocation}.`
            : ""}
        </div>
      </div>
    );
  }

  return children;
}
