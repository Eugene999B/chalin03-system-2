import { Navigate, useLocation } from "react-router";
import { useAuth } from "../context/AuthContext";
import {
  EQUIPMENT_DIVISIONS,
  canAccessEquipmentDivision,
} from "../security/equipmentDivisionAccess";

function equipmentDivisionForPath(pathname) {
  if (pathname.startsWith("/equipment-installment-finance")) {
    return EQUIPMENT_DIVISIONS.FINANCE;
  }
  if (pathname.startsWith("/equipment-hire-operations")) {
    return EQUIPMENT_DIVISIONS.HIRE;
  }
  return null;
}

export default function PermissionRoute({
  permissions = [],
  anyPermissions = [],
  allowedRoles = [],
  children,
}) {
  const location = useLocation();
  const { user, role, workspaceName, workspaceCode, hasEveryPermission, hasAnyPermission } =
    useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const requiredDivision = equipmentDivisionForPath(location.pathname);
  const divisionAllowed = requiredDivision
    ? canAccessEquipmentDivision(user, requiredDivision)
    : true;
  const allowedRoleValues = allowedRoles.map((item) =>
    String(item || "").toLowerCase()
  );
  const roleAllowed =
    allowedRoleValues.length === 0 ||
    allowedRoleValues.includes(String(role || "").toLowerCase());

  // Finance routes still carry legacy fleet permission names internally. A
  // Finance-only role may pass those route wrappers, while the API independently
  // enforces the division and action boundary for every request.
  const financeLegacyPermissions =
    requiredDivision === EQUIPMENT_DIVISIONS.FINANCE &&
    divisionAllowed &&
    [...permissions, ...anyPermissions].every((permission) =>
      String(permission || "").startsWith("fleet.assets.")
    );
  const permissionsAllowed =
    financeLegacyPermissions || hasEveryPermission(permissions);
  const anyAllowed = financeLegacyPermissions || hasAnyPermission(anyPermissions);

  if (!divisionAllowed || !roleAllowed || !permissionsAllowed || !anyAllowed) {
    const context =
      workspaceName ||
      (workspaceCode === "mining"
        ? "Mining Operations"
        : workspaceCode === "equipment_hire"
        ? "Equipment Business"
        : "this workspace");

    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Access Denied</h1>
            <p>You are not allowed to open this page in {context}.</p>
          </div>
        </div>

        <div className="error-box">
          {requiredDivision && !divisionAllowed
            ? "This account is assigned to the other Equipment division. Hire jobs and Installment Finance work cannot be opened by the same ordinary staff role."
            : "Your account does not have permission to perform this action."}
        </div>
      </div>
    );
  }

  return children;
}
