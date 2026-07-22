import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { saveLastWork } from "../utils/commandGate";

const EXCLUDED_PATHS = new Set([
  "/login",
  "/owner-recovery",
  "/change-password",
  "/mining/change-password",
  "/equipment-hire-operations/change-password",
  "/device-access",
  "/mining/device-access",
  "/equipment-hire-operations/device-access",
]);

export default function LastWorkTracker() {
  const location = useLocation();
  const { isLoggedIn, workspaceCode } = useAuth();

  useEffect(() => {
    if (!isLoggedIn || EXCLUDED_PATHS.has(location.pathname)) {
      return;
    }

    saveLastWork(workspaceCode, location.pathname);
  }, [isLoggedIn, location.pathname, workspaceCode]);

  return null;
}
