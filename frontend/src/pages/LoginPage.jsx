import { useEffect, useState } from "react";
import { openEmergencyCommand } from "../components/EmergencyCommandOverlay";
import { useAuth } from "../context/AuthContext";
import LoginPageGroupOperations from "./LoginPageGroupOperations.jsx";

const TOKEN_KEY = "chalin03_token";
const USER_KEY = "chalin03_user";
const LOCAL_CONTEXT_KEYS = [
  "chalin03_active_context_mining",
  "chalin03_active_context_equipment_hire",
];

function hasStoredSession() {
  return Boolean(
    localStorage.getItem(TOKEN_KEY) || localStorage.getItem(USER_KEY)
  );
}

function clearStoredSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  for (const key of LOCAL_CONTEXT_KEYS) localStorage.removeItem(key);
  sessionStorage.removeItem("chalin03_command_arrival");
}

export default function LoginPage() {
  const { logout } = useAuth();
  const [clearingPreviousSession] = useState(hasStoredSession);

  useEffect(() => {
    if (!clearingPreviousSession) return undefined;

    // Existing layout buttons start the server logout request and navigate here.
    // Clear the browser session immediately so Login cannot see stale auth state
    // and redirect the user back into a workspace before logout finishes.
    void logout();
    clearStoredSession();
    window.location.replace(
      `${window.location.pathname}${window.location.search}${window.location.hash}`
    );

    return undefined;
  }, [clearingPreviousSession, logout]);

  useEffect(() => {
    function unlockPasswordOnFirstTap(event) {
      const input = event.target.closest?.('input[data-lpignore="true"]');
      if (!input) return;

      // Some mobile browsers do not open the keyboard when a read-only input is
      // unlocked only during focus. Remove the DOM flag on pointer-down; the
      // controlled component's focus handler then records the same state.
      input.readOnly = false;
      window.queueMicrotask(() => input.focus({ preventScroll: true }));
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
    const emergencyTimer = window.setInterval(restoreEmergencyMode, 100);

    return () => {
      document.removeEventListener("pointerdown", unlockPasswordOnFirstTap, true);
      window.clearInterval(emergencyTimer);
    };
  }, []);

  if (clearingPreviousSession) {
    return (
      <main
        role="status"
        aria-live="polite"
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          background: "#07182c",
          color: "#ffffff",
          textAlign: "center",
          fontWeight: 800,
        }}
      >
        Closing the previous session and opening Login…
      </main>
    );
  }

  return <LoginPageGroupOperations />;
}
