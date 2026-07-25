import { Navigate, useLocation } from "react-router";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children }) {
  const location = useLocation();
  const {
    isLoggedIn,
    user,
    branchId,
    workspaceCode,
    isSparePartsWorkspace,
    mustChangePassword,
    loading,
  } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          background: "#eef2f7",
          color: "#17365d",
          textAlign: "center",
          fontWeight: 900,
        }}
      >
        <div>
          <div style={{ fontSize: "34px", marginBottom: "10px" }}>⏳</div>
          Restoring your secure Chalin 03 session...
        </div>
      </div>
    );
  }

  if (!isLoggedIn || !user) {
    return <Navigate to="/login" replace />;
  }

  if (!workspaceCode) {
    return <Navigate to="/login" replace />;
  }

  if (isSparePartsWorkspace && !branchId) {
    return <Navigate to="/login" replace />;
  }

  const isChangePasswordPage = location.pathname.endsWith("/change-password");

  if (mustChangePassword && !isChangePasswordPage) {
    const changePasswordPath =
      workspaceCode === "mining"
        ? "/mining/change-password"
        : workspaceCode === "equipment_hire"
        ? "/equipment-hire-operations/change-password"
        : "/change-password";

    return <Navigate to={changePasswordPath} replace />;
  }

  return children;
}
