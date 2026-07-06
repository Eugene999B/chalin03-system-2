import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children }) {
  const { isLoggedIn, user, branchId } = useAuth();

  if (!isLoggedIn || !user) {
    return <Navigate to="/login" replace />;
  }

  const selectedBranchId =
    branchId || user?.branch_id || user?.default_branch_id || null;

  if (!selectedBranchId) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
