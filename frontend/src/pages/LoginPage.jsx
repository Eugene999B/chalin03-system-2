import { useEffect, useState } from "react";
import { openEmergencyCommand } from "../components/EmergencyCommandOverlay";
import { useAuth } from "../context/AuthContext";
import LoginPageGroupOperations from "./LoginPageGroupOperations.jsx";
import "../styles/chalin03LoginBespoke.css";
import "../styles/loginBusinessSelectionSync.css";
import "../styles/loginArtworkScale.css";
import "../styles/loginBusinessSelectionOriginalScale.css";
import "../styles/loginEmojiRestore.css";
import "../styles/loginMobileDesktopMatch.css";
import "../styles/loginMobileOriginalDesign.css";

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
