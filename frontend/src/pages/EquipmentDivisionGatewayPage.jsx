import { Link, Navigate } from "react-router";
import { useAuth } from "../context/AuthContext";
import { HIRE_VIEW_PERMISSIONS } from "../security/permissionRules";
import "../styles/equipmentDivisionGateway.css";

const hireFeatures = [
  "Customer hire enquiries and availability",
  "Hire quotations and contracts",
  "Dispatch, job cards and work logs",
  "Hire invoices, payments and balances",
  "Return inspection and utilisation reports",
];

const financeFeatures = [
  "Installment portfolio command centre",
  "Applications, quotations and agreements",
  "Scheduled payments and customer accounts",
  "Collections, reminders and risk control",
  "Delivery, completion and ownership transfer",
];

function AccessBadge({ allowed }) {
  return (
    <span
      className={`equipment-gateway__access ${allowed ? "is-allowed" : "is-restricted"}`}
    >
      {allowed ? "Access available" : "Permission required"}
    </span>
  );
}

function DivisionCard({
  tone,
  eyebrow,
  icon,
  title,
  description,
  features,
  route,
  action,
  allowed,
}) {
  const content = (
    <>
      <div className="equipment-gateway__card-top">
        <span className="equipment-gateway__division-icon" aria-hidden="true">
          {icon}
        </span>
        <AccessBadge allowed={allowed} />
      </div>

      <div className="equipment-gateway__card-copy">
        <p>{eyebrow}</p>
        <h2>{title}</h2>
        <span>{description}</span>
      </div>

      <ul>
        {features.map((feature) => (
          <li key={feature}>
            <span aria-hidden="true">✓</span>
            {feature}
          </li>
        ))}
      </ul>

      <div className="equipment-gateway__card-action">
        <strong>{allowed ? action : "Your account cannot open this division"}</strong>
        <span aria-hidden="true">→</span>
      </div>
    </>
  );

  if (!allowed) {
    return (
      <article
        className={`equipment-gateway__division-card is-${tone} is-disabled`}
        aria-disabled="true"
      >
        {content}
      </article>
    );
  }

  return (
    <Link className={`equipment-gateway__division-card is-${tone}`} to={route}>
      {content}
    </Link>
  );
}

export default function EquipmentDivisionGatewayPage() {
  const {
    isLoggedIn,
    workspaceCode,
    effectivePermissions = [],
    user,
  } = useAuth();

  if (!isLoggedIn) {
    return <Navigate to="/login?workspace=equipment_hire" replace />;
  }

  if (workspaceCode !== "equipment_hire") {
    return <Navigate to="/login?workspace=equipment_hire" replace />;
  }

  const role = String(user?.role || "").toLowerCase();
  const privileged = [
    "admin",
    "administrator",
    "manager",
    "system_administrator",
  ].includes(role);
  const canOpenHire =
    privileged ||
    HIRE_VIEW_PERMISSIONS.some((permission) =>
      effectivePermissions.includes(permission)
    );
  const canOpenFinance =
    privileged || effectivePermissions.includes("fleet.assets.view");
  const displayName = user?.full_name || user?.username || "Authorised staff";

  return (
    <main className="equipment-gateway">
      <div className="equipment-gateway__ambient" aria-hidden="true" />

      <header className="equipment-gateway__topbar">
        <a className="equipment-gateway__brand" href="/company/">
          <span className="equipment-gateway__logo">
            <img src="/chalin03-logo.png" alt="" />
            <strong>C03</strong>
          </span>
          <span>
            <small>Chalin 03 Company Limited</small>
            <strong>Equipment Business</strong>
          </span>
        </a>

        <div className="equipment-gateway__identity">
          <span className="equipment-gateway__status-dot" />
          <div>
            <small>Secure staff session</small>
            <strong>{displayName}</strong>
          </div>
        </div>
      </header>

      <section className="equipment-gateway__hero">
        <div className="equipment-gateway__hero-copy">
          <div className="equipment-gateway__badges">
            <span>One secure equipment workspace</span>
            <span>Two independent divisions</span>
            <span>Shared records, separate workflows</span>
          </div>
          <p className="equipment-gateway__eyebrow">Choose your operating division</p>
          <h1>
            Equipment Hire <em>or</em> Installment Finance
          </h1>
          <p>
            Enter the division that matches the customer journey. Hire work and
            installment-finance work remain clearly separated, while authorised
            customers, machines and equipment locations stay consistent underneath.
          </p>
        </div>

        <aside className="equipment-gateway__principle">
          <span aria-hidden="true">🛡️</span>
          <div>
            <small>Protected separation</small>
            <strong>No duplicate customers or machines</strong>
            <p>
              Hire contracts never become installment agreements, and finance
              accounts never become Hire jobs. Shared equipment safeguards prevent
              conflicting assignments.
            </p>
          </div>
        </aside>
      </section>

      <section className="equipment-gateway__division-grid" aria-label="Equipment divisions">
        <DivisionCard
          tone="hire"
          eyebrow="Operational division"
          icon="🏗️"
          title="Equipment Hire Operations"
          description="For temporary equipment use, customer jobs, dispatch, billing and returns."
          features={hireFeatures}
          route="/equipment-hire-operations?division=hire"
          action="Open Equipment Hire"
          allowed={canOpenHire}
        />

        <DivisionCard
          tone="finance"
          eyebrow="Finance division"
          icon="🏦"
          title="Equipment Installment Finance"
          description="For equipment purchase applications, scheduled payments, collections and ownership."
          features={financeFeatures}
          route="/equipment-installment-finance"
          action="Open Installment Finance"
          allowed={canOpenFinance}
        />
      </section>

      <section className="equipment-gateway__shared-strip">
        <div>
          <span aria-hidden="true">🚜</span>
          <p><strong>One equipment register</strong><small>Identity, pictures, condition and availability remain consistent.</small></p>
        </div>
        <div>
          <span aria-hidden="true">👥</span>
          <p><strong>Reusable customer identity</strong><small>Customer details are shared safely without mixing commercial records.</small></p>
        </div>
        <div>
          <span aria-hidden="true">📍</span>
          <p><strong>Authorised locations</strong><small>Both divisions respect the equipment locations granted to the staff account.</small></p>
        </div>
        <div>
          <span aria-hidden="true">🔐</span>
          <p><strong>Separate permissions</strong><small>Unavailable divisions remain protected by server and route permissions.</small></p>
        </div>
      </section>

      <footer className="equipment-gateway__footer">
        <span>Equipment Hire &amp; Installment Finance</span>
        <span>Dunkwa Police Barrier, Ghana</span>
      </footer>
    </main>
  );
}
