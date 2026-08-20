import { Navigate } from "react-router";

export default function MiningPortalPage() {
  return <Navigate to="/login?workspace=mining" replace />;
}
