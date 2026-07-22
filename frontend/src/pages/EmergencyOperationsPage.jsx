import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "../styles/commandGate.css";

const ACTIONS = {
  spare_parts: [
    { icon: "🛒", title: "Urgent sale", description: "Open the sales station for an urgent customer transaction.", path: "/new-sale" },
    { icon: "📦", title: "Critical stock request", description: "Check products, quantities and stock records immediately.", path: "/products" },
    { icon: "🔔", title: "Operational alerts", description: "Review active business alerts and notices.", path: "/notifications", permission: "notifications.view" },
    { icon: "📘", title: "Recovery guide", description: "Open the built-in operating and recovery guide.", path: "/help" },
  ],
  mining: [
    { icon: "🛡️", title: "Safety incident", description: "Record or review a mining safety incident.", path: "/mining/incidents", permission: "mining.incidents.view" },
    { icon: "⛽", title: "Emergency fuel", description: "Open fuel receipt, issue and control operations.", path: "/mining/fuel", permission: "mining.fuel.view" },
    { icon: "🚜", title: "Equipment breakdown", description: "Open machine hours, downtime and equipment operations.", path: "/mining/equipment", permission: "mining.equipment_logs.view" },
    { icon: "🔔", title: "Site alerts", description: "Review safety, fuel, closing and production alerts.", path: "/mining/notifications", permission: "notifications.view" },
  ],
  equipment_hire: [
    { icon: "🚚", title: "Urgent dispatch", description: "Open dispatch and active job operations.", path: "/equipment-hire-operations/operations", permission: "hire.dispatch.view" },
    { icon: "🔧", title: "Customer breakdown", description: "Open active operations for a customer machine issue.", path: "/equipment-hire-operations/operations", permission: "hire.operations.view" },
    { icon: "🔍", title: "Emergency return", description: "Open return inspection and machine condition records.", path: "/equipment-hire-operations/returns", permission: "hire.returns.view" },
    { icon: "🔔", title: "Hire alerts", description: "Review contract, dispatch and payment alerts.", path: "/equipment-hire-operations/notifications", permission: "notifications.view" },
  ],
};

const HOME_ROUTES = {
  spare_parts: "/",
  mining: "/mining",
  equipment_hire: "/equipment-hire-operations",
};

export default function EmergencyOperationsPage() {
  const navigate = useNavigate();
  const { hasPermission, role, user, workspaceCode, workspaceName } = useAuth();
  const elevated = role === "admin" || role === "manager";

  const availableActions = useMemo(
    () =>
      (ACTIONS[workspaceCode] || ACTIONS.spare_parts).filter(
        (action) => !action.permission || elevated || hasPermission(action.permission)
      ),
    [elevated, hasPermission, workspaceCode]
  );

  return (
    <main className="command-page">
      <div className="command-page__shell">
        <header className="command-page__hero">
          <div>
            <p>Protected rapid entrance</p>
            <h1>Emergency Operations</h1>
          </div>
          <span>
            {user?.full_name || user?.username} · {workspaceName || workspaceCode}. Only
            authorised actions are shown; this mode never bypasses permissions or audit controls.
          </span>
        </header>

        <section className="command-page__card command-page__card--wide" style={{ marginTop: 18 }}>
          <h2>Choose the essential operation</h2>
          <p>
            This focused screen reduces navigation during a safety, breakdown, fuel, stock or
            customer-service emergency. All records continue through the normal protected pages.
          </p>
          <div className="emergency-action-grid">
            {availableActions.map((action) => (
              <article className="emergency-action" key={`${action.title}-${action.path}`}>
                <span>{action.icon}</span>
                <div>
                  <h3>{action.title}</h3>
                  <p>{action.description}</p>
                </div>
                <button type="button" onClick={() => navigate(action.path)}>
                  Open operation
                </button>
              </article>
            ))}
          </div>
          <button
            className="command-page__button command-page__button--secondary"
            type="button"
            style={{ marginTop: 18 }}
            onClick={() => navigate(HOME_ROUTES[workspaceCode] || "/")}
          >
            Return to full command centre
          </button>
        </section>
      </div>
    </main>
  );
}
