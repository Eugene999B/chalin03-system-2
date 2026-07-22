import { useEffect } from "react";
import { openEmergencyCommand } from "../components/EmergencyCommandOverlay";
import LoginPageBiometricBank from "./LoginPageBiometricBank.jsx";

export default function LoginPage() {
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

  return <LoginPageBiometricBank />;
}
