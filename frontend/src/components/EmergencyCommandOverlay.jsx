import { useEffect, useMemo, useState } from "react";
import { getBusinessWorkspace } from "../data/businessWorkspaces";
import "../styles/commandGate.css";

const FLAG_KEY = "chalin03_emergency_command";
// UI-only switch. It never changes API responses, database records, or permissions.
// Set to false to restore normal visibility.
const DATA_VISIBILITY_PAUSE = true;
const HIDDEN_WORKSPACES = new Set(["spare_parts", "equipment_installment_finance", "installment_finance"]);
const DATA_MASK_CLASS = "chalin03-data-visibility-mask";
const DATA_MASK_STYLE_ID = "chalin03-data-visibility-mask-style";

const DATA_MASK_CSS = `
html.${DATA_MASK_CLASS} .bwl-content table tbody tr > td {
  color: transparent !important;
  text-shadow: none !important;
}

html.${DATA_MASK_CLASS} .bwl-content table tbody tr img,
html.${DATA_MASK_CLASS} .bwl-content table tbody tr svg {
  visibility: hidden !important;
}

html.${DATA_MASK_CLASS} .bwl-content [data-chalin03-db-record],
html.${DATA_MASK_CLASS} .bwl-content [data-chalin03-db-record-row] {
  color: transparent !important;
  text-shadow: none !important;
}

html.${DATA_MASK_CLASS} .bwl-content [data-chalin03-db-record] img,
html.${DATA_MASK_CLASS} .bwl-content [data-chalin03-db-record] svg,
html.${DATA_MASK_CLASS} .bwl-content [data-chalin03-db-record-row] img,
html.${DATA_MASK_CLASS} .bwl-content [data-chalin03-db-record-row] svg {
  visibility: hidden !important;
}

html.${DATA_MASK_CLASS} .bwl-content input[readonly],
html.${DATA_MASK_CLASS} .bwl-content textarea[readonly] {
  color: transparent !important;
  text-shadow: none !important;
}

html.${DATA_MASK_CLASS} .bwl-content select option:not(:first-child) {
  color: transparent !important;
}
`;

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

  const hasToken = Boolean(localStorage.getItem("chalin03_token"));
  const workspaceCode = String(
    user?.workspace_code || user?.active_workspace?.code || command?.workspaceCode || "spare_parts"
  ).toLowerCase();
  const hiddenModeActive = Boolean(
    user &&
      hasToken &&
      DATA_VISIBILITY_PAUSE &&
      HIDDEN_WORKSPACES.has(workspaceCode)
  );

  useEffect(() => {
    const root = document.documentElement;
    const existingStyle = document.getElementById(DATA_MASK_STYLE_ID);

    if (existingStyle) existingStyle.remove();

    if (!hiddenModeActive) {
      root.classList.remove(DATA_MASK_CLASS);
      return undefined;
    }

    root.classList.add(DATA_MASK_CLASS);
    const style = document.createElement("style");
    style.id = DATA_MASK_STYLE_ID;
    style.textContent = DATA_MASK_CSS;
    document.head.appendChild(style);

    return () => {
      root.classList.remove(DATA_MASK_CLASS);
      style.remove();
    };
  }, [hiddenModeActive]);

  function close() {
    sessionStorage.removeItem(FLAG_KEY);
    setCommand(null);
  }

  if (!user || !hasToken || hiddenModeActive || !command) {
    return null;
  }

  const commandWorkspaceCode = command.workspaceCode || workspaceCode;
  const workspace = getBusinessWorkspace(commandWorkspaceCode);
  const actions = ACTIONS[commandWorkspaceCode] || ACTIONS.spare_parts;

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
