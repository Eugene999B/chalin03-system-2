import { useEffect } from "react";
import { Navigate } from "react-router";
import { openEmergencyCommand } from "../components/EmergencyCommandOverlay";
import { useAuth } from "../context/AuthContext";
import { getWorkspaceHomeRoute } from "../data/businessWorkspaces";
import LoginPageGroupOperations from "./LoginPageGroupOperations.jsx";
import "../styles/chalin03LoginBespoke.css";
import "../styles/loginBusinessSelectionSync.css";
import "../styles/loginArtworkScale.css";
import "../styles/loginBusinessSelectionOriginalScale.css";
import "../styles/loginEmojiRestore.css";
import "../styles/loginMobileDesktopMatch.css";
import "../styles/loginMobileOriginalDesign.css";
import "../styles/loginMobileCompactFinal.css";

export default function LoginPage() {
  const { isLoggedIn, loading, workspaceCode } = useAuth();

  useEffect(() => {
    function unlockPasswordOnFirstTap(event) {
      const input = event.target.closest?.('input[data-lpignore="true"]');
      if (!input) return;
      input.readOnly = false;
      window.queueMicrotask(() => input.focus({ preventScroll: true }));
    }

    function syncGroupBusinessSelection(event) {
      const node = event.target.closest?.(".group-operations-map__node");
      if (!node) return;

      const targetIndex = node.classList.contains("is-parts")
        ? 0
        : node.classList.contains("is-mining")
          ? 1
          : node.classList.contains("is-hire")
            ? 2
            : -1;

      if (targetIndex < 0) return;

      const tabs = document.querySelectorAll(
        ".gate4__workspace-tabs button"
      );
      const target = tabs[targetIndex];
      if (!target) return;

      target.click();
    }

    let lastEmergencyArrival = "";
    function restoreEmergencyMode() {
      const rawArrival = sessionStorage.getItem("chalin03_command_arrival") || "";
      if (!rawArrival || rawArrival === lastEmergencyArrival) return;

      try {
        const arrival = JSON.parse(rawArrival);
        if (arrival?.emergencyMode) {
          lastEmergencyArrival = rawArrival;
          openEmergencyCommand(arrival.workspaceCode || "spare_parts");
        }
      } catch {
        // Ignore malformed transient arrival state; normal login remains safe.
      }
    }

    document.addEventListener("pointerdown", unlockPasswordOnFirstTap, true);
    document.addEventListener("click", syncGroupBusinessSelection, true);
    const emergencyTimer = window.setInterval(restoreEmergencyMode, 100);

    return () => {
      document.removeEventListener("pointerdown", unlockPasswordOnFirstTap, true);
      document.removeEventListener("click", syncGroupBusinessSelection, true);
      window.clearInterval(emergencyTimer);
    };
  }, []);

  if (loading) {
    return (
      <main role="status" aria-live="polite" style={{
        minHeight: "100vh", display: "grid", placeItems: "center",
        padding: "24px", background: "#07182c", color: "#fff",
        textAlign: "center", fontWeight: 800,
      }}>
        Restoring your secure Chalin 03 session...
      </main>
    );
  }

  // Visiting the sign-in route must never revoke a valid authenticated
  // session. Explicit Logout/Back to Login controls handle revocation.
  if (isLoggedIn) {
    return <Navigate to={getWorkspaceHomeRoute(workspaceCode)} replace />;
  }

  return <LoginPageGroupOperations />;
}
