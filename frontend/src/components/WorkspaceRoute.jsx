import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getWorkspaceHomeRoute } from "../data/businessWorkspaces";

export default function WorkspaceRoute({ allowedWorkspaces = [], children }) {
  const { workspaceCode } = useAuth();
  const allowedCodes = allowedWorkspaces.map((code) => String(code || ""));

  if (!allowedCodes.includes(workspaceCode)) {
    return <Navigate to={getWorkspaceHomeRoute(workspaceCode)} replace />;
  }

  return children;
}
