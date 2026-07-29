import { Link, Navigate } from "react-router";
import EquipmentDivisionStaffManager from "../components/EquipmentDivisionStaffManager";
import { useAuth } from "../context/AuthContext";
import {
  EQUIPMENT_DIVISIONS,
  canAccessEquipmentDivision,
} from "../security/equipmentDivisionAccess";
import "../styles/equipmentDivisionGateway.css";
import "../styles/equipmentDivisionGateway.mobile.css";

const hireFeatures = [
  "Hire customer enquiries and availability",
  "Hire quotations and Hire contracts",
  "Dispatch, job cards and Hire work logs",
  "Hire invoices, payments and balances",
  "Return inspection and Hire utilisation reports",
];

const financeFeatures = [
  "Credit applications, KYC and affordability",
  "Finance approval and installment agreements",
  "Scheduled installment payments and accounts",
  "Finance collections, reminders and risk control",
  "Finance delivery completion and ownership transfer",
];

function AccessBadge({ allowed }) {
  return (
    <span
      className={`equipment-gateway__access ${allowed ? "is-allowed" : "is-restricted"}`}
    >
      {allowed ? "Assigned division" : "Different staff division"}
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
        <strong>{allowed ? action : "This account belongs to the other division"}</strong>
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
  const { isLoggedIn, workspaceCode, user } = useAuth();

  if (!isLoggedIn) {
    return <Navigate to="/login?workspace=equipment_hire" replace />;
  }

  if (workspaceCode !== "equipment_hire") {
    return <Navigate to="/login?workspace=equipment_hire" replace />;
  }

  const canOpenHire = canAccessEquipmentDivision(user, EQUIPMENT_DIVISIONS.HIRE);
  const canOpenFinance = canAccessEquipmentDivision(
    user,
    EQUIPMENT_DIVISIONS.FINANCE
  );
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
          <EquipmentDivisionStaffManager user={user} />
        </div>
      </header>

      <section className="equipment-gateway__hero">
        <div className="equipment-gateway__hero-copy">
          <div className="equipment-gateway__badges">
            <span>Two independent staff divisions</span>
            <span>Role-isolated work queues</span>
            <span>Reference-only equipment register</span>
          </div>
          <p className="equipment-gateway__eyebrow">Open your assigned division</p>
          <h1>
            Equipment Hire <em>or</em> Installment Finance
          </h1>
          <p>
            Each ordinary staff account belongs to one division. Hire jobs remain in
            Equipment Hire Operations, while credit, installment and ownership work
            remains in Equipment Installment Finance.
          </p>
        </div>

        <aside className="equipment-gateway__principle">
          <span aria-hidden="true">🛡️</span>
          <div>
            <small>Hard division boundary</small>
            <strong>No staff workflow crossover</strong>
            <p>
              Hire contracts never become finance accounts, finance applications never
              become Hire jobs, and a Hire employee cannot open Finance work merely
              because the employee can view a machine.
            </p>
          </div>
        </aside>
      </section>

      <section className="equipment-gateway__division-grid" aria-label="Equipment divisions">
        <DivisionCard
          tone="hire"
          eyebrow="Hire staff division"
          icon="🏗️"
          title="Equipment Hire Operations"
          description="Temporary equipment use, customer Hire jobs, dispatch, Hire billing and returns."
          features={hireFeatures}
          route="/equipment-hire-operations?division=hire"
          action="Open assigned Hire work"
          allowed={canOpenHire}
        />

        <DivisionCard
          tone="finance"
          eyebrow="Finance staff division"
          icon="🏦"
          title="Equipment Installment Finance"
          description="Equipment purchase credit, installment accounts, collections and ownership."
          features={financeFeatures}
          route="/equipment-installment-finance"
          action="Open assigned Finance work"
          allowed={canOpenFinance}
        />
      </section>

      <section className="equipment-gateway__shared-strip">
        <div>
          <span aria-hidden="true">🚜</span>
          <p><strong>Reference-only machine identity</strong><small>Both divisions may identify the same physical machine without sharing a job, contract or account.</small></p>
        </div>
        <div>
          <span aria-hidden="true">👥</span>
          <p><strong>Independent customer transactions</strong><small>A customer identity may be recognised, but Hire and Finance commercial records remain separate.</small></p>
        </div>
        <div>
          <span aria-hidden="true">👔</span>
          <p><strong>Division-specific staff roles</strong><small>Hire employees cannot enter Finance work, and Finance employees cannot enter Hire operations.</small></p>
        </div>
        <div>
          <span aria-hidden="true">📊</span>
          <p><strong>Separate evidence and reports</strong><small>Each division keeps its own documents, balances, audit actions and operating reports.</small></p>
        </div>
      </section>

      <footer className="equipment-gateway__footer">
        <span>Equipment Hire &amp; Installment Finance</span>
        <span>Dunkwa Police Barrier, Ghana</span>
      </footer>
    </main>
  );
}
