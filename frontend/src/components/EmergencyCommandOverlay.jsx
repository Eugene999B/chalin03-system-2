import { useEffect, useMemo, useState } from "react";
import { getBusinessWorkspace } from "../data/businessWorkspaces";
import "../styles/commandGate.css";

const FLAG_KEY = "chalin03_emergency_command";
// UI-only switch. It never changes API responses, database records, or permissions.
// Set to false to restore normal visibility.
const DATA_VISIBILITY_PAUSE = true;

const ACTIONS = {
  spare_parts: [
    { icon: "🛒", title: "Urgent sale", description: "Open the sales station for an urgent customer transaction.", path: "/new-sale" },
    { icon: "📦", title: "Critical stock request", description: "Check products, quantities and stock records immediately.", path: "/products" },
    { icon: "🔔", title: "Operational alerts", description: "Review active business alerts and notices.", path: "/notifications" },
    { icon: "📘", title: "Recovery guide", description: "Open the built-in operating and recovery guide.", path: "/help" },
  ],
  mining: [
    { icon: "🛡️", title: "Safety incident", description: "Record or review a mining safety incident.", path: "/mining/incidents" },
    { icon: "⛽", title: "Emergency fuel", description: "Open fuel receipt, issue and control operations.", path: "/mining/fuel" },
    { icon: "🚜", title: "Equipment breakdown", description: "Open machine hours, downtime and equipment operations.", path: "/mining/equipment" },
    { icon: "🔔", title: "Site alerts", description: "Review safety, fuel, closing and production alerts.", path: "/mining/notifications" },
  ],
  equipment_hire: [
    { icon: "🚚", title: "Urgent dispatch", description: "Open dispatch and active job operations.", path: "/equipment-hire-operations/operations" },
    { icon: "🔧", title: "Customer breakdown", description: "Open active operations for a customer machine issue.", path: "/equipment-hire-operations/operations" },
    { icon: "🔍", title: "Emergency return", description: "Open return inspection and machine condition records.", path: "/equipment-hire-operations/returns" },
    { icon: "🔔", title: "Hire alerts", description: "Review contract, dispatch and payment alerts.", path: "/equipment-hire-operations/notifications" },
  ],
};

function readCommand() {
  try {
    return JSON.parse(sessionStorage.getItem(FLAG_KEY) || "null");
  } catch {
    sessionStorage.removeItem(FLAG_KEY);
    return null;
  }
}

export function openEmergencyCommand(workspaceCode) {
  sessionStorage.setItem(
    FLAG_KEY,
    JSON.stringify({
      workspaceCode,
      openedAt: new Date().toISOString(),
    })
  );
}

export default function EmergencyCommandOverlay() {
  const [command, setCommand] = useState(() => readCommand());

  useEffect(() => {
    function refresh() {
      setCommand(readCommand());
    }

    window.addEventListener("chalin03:emergency-command", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("chalin03:emergency-command", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const user = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("chalin03_user") || "null");
    } catch {
      return null;
    }
  }, [command]);

  const hasSession = Boolean(user && localStorage.getItem("chalin03_token"));

  useEffect(() => {
    if (!hasSession || !DATA_VISIBILITY_PAUSE) return undefined;

    const previousUserSelect = document.body.style.userSelect;
    const previousPointerEvents = document.body.style.pointerEvents;
    document.body.style.userSelect = "none";
    document.body.style.pointerEvents = "none";

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.pointerEvents = previousPointerEvents;
    };
  }, [hasSession]);

  if (!hasSession) {
    return null;
  }

  if (DATA_VISIBILITY_PAUSE) {
    return (
      <div
        className="command-modal command-emergency-overlay chalin03-data-visibility-blank"
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 2147483000,
          width: "100vw",
          height: "100vh",
          background: "#ffffff",
          pointerEvents: "auto",
          cursor: "default",
        }}
      />
    );
  }

  if (!command || !user) {
    return null;
  }

  const commandWorkspaceCode = command.workspaceCode || "spare_parts";
  const workspace = getBusinessWorkspace(commandWorkspaceCode);
  const actions = ACTIONS[commandWorkspaceCode] || ACTIONS.spare_parts;

  function close() {
    sessionStorage.removeItem(FLAG_KEY);
    setCommand(null);
  }

  function open(path) {
    close();
    window.location.assign(path);
  }

  return (
    <div className="command-modal command-emergency-overlay" role="dialog" aria-modal="true" aria-label="Emergency Operations">
      <section className="command-emergency-panel">
        <header className="command-emergency-header">
          <div>
            <p>Protected rapid entrance</p>
            <h2>Emergency Operations</h2>
            <span>
              {workspace?.name || "Chalin 03"} · {user.full_name || user.username || "Authorised worker"}
            </span>
          </div>
          <button type="button" onClick={close} aria-label="Close Emergency Operations">×</button>
        </header>

        <div className="command-emergency-notice">
          This mode never bypasses permissions. Every action opens the normal protected page and remains fully audited.
        </div>

        <div className="emergency-action-grid">
          {actions.map((action) => (
            <article className="emergency-action" key={`${action.title}-${action.path}`}>
              <span>{action.icon}</span>
              <div>
                <h3>{action.title}</h3>
                <p>{action.description}</p>
              </div>
              <button type="button" onClick={() => open(action.path)}>Open operation</button>
            </article>
          ))}
        </div>

        <button className="command-page__button command-page__button--secondary" type="button" onClick={close}>
          Continue to full command centre
        </button>
      </section>
    </div>
  );
}
