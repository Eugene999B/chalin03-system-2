import { Navigate } from "react-router";
import { useAuth } from "../context/AuthContext";

export default function PermissionRoute({
  permissions = [],
  anyPermissions = [],
  allowedRoles = [],
  children,
}) {
  const { user, role, workspaceName, workspaceCode, hasEveryPermission, hasAnyPermission } =
    useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const allowedRoleValues = allowedRoles.map((item) =>
    String(item || "").toLowerCase()
  );
  const roleAllowed =
    allowedRoleValues.length === 0 ||
    allowedRoleValues.includes(String(role || "").toLowerCase());
  const permissionsAllowed = hasEveryPermission(permissions);
  const anyAllowed = hasAnyPermission(anyPermissions);

  if (!roleAllowed || !permissionsAllowed || !anyAllowed) {
    const context =
      workspaceName ||
      (workspaceCode === "mining"
        ? "Mining Operations"
        : workspaceCode === "equipment_hire"
        ? "Equipment Hire"
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
          Your account does not have permission to perform this action.
        </div>
      </div>
    );
  }

  return children;
}
