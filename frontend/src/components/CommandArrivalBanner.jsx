import { useEffect, useState } from "react";
import { describeResumePath } from "../utils/commandGate";
import "../styles/commandArrivalBanner.css";

const KEY = "chalin03_command_arrival";

function readArrival() {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (!value) return null;

    const age = Date.now() - new Date(value.createdAt || 0).getTime();
    if (!Number.isFinite(age) || age > 60_000) {
      sessionStorage.removeItem(KEY);
      return null;
    }

    return value;
  } catch {
    sessionStorage.removeItem(KEY);
    return null;
  }
}

export default function CommandArrivalBanner() {
  const [arrival, setArrival] = useState(() => readArrival());

  useEffect(() => {
    if (!arrival) return undefined;

    const timer = window.setTimeout(() => {
      sessionStorage.removeItem(KEY);
      setArrival(null);
    }, 7000);

    return () => window.clearTimeout(timer);
  }, [arrival]);

  if (!arrival) return null;

  const securityText =
    arrival.deviceSetupStatus === "registered"
      ? "Device security enabled automatically"
      : arrival.deviceSetupStatus === "already-ready"
      ? "Trusted device recognised"
      : "Secure password session established";

  return (
    <aside className="command-arrival" role="status" aria-live="polite">
      <div className="command-arrival__icon" aria-hidden="true">✓</div>
      <div className="command-arrival__copy">
        <small>{arrival.workspaceName || "Chalin 03"}</small>
        <strong>Welcome back, {arrival.userName}.</strong>
        <span>
          {arrival.role} · Opening {arrival.destinationLabel || describeResumePath(arrival.destination)}
        </span>
        <em>{securityText}</em>
      </div>
      <button
        type="button"
        aria-label="Dismiss welcome message"
        onClick={() => {
          sessionStorage.removeItem(KEY);
          setArrival(null);
        }}
      >
        ×
      </button>
    </aside>
  );
}
