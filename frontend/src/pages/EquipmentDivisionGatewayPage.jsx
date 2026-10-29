import { useState } from "react";
import { Link, Navigate } from "react-router";
import EquipmentDivisionStaffManager from "../components/EquipmentDivisionStaffManager";
import { useAuth } from "../context/AuthContext";
import {
  EQUIPMENT_DIVISIONS,
  canAccessEquipmentDivision,
} from "../security/equipmentDivisionAccess";
import "../styles/equipmentBusinessExperience.css";

const hireFeatures = [
  "Hire enquiries, quotations and availability",
  "Contracts, dispatch and job cards",
  "Hire invoices, payments and returns",
  "Fleet, maintenance and utilisation reports",
];

const financeFeatures = [
  "Credit applications, KYC and affordability",
  "Approval, agreements and deposits",
  "Installment collections and account control",
  "Delivery completion and ownership transfer",
];

function DivisionCard({
  tone,
  icon,
  label,
  title,
  description,
  features,
  route,
  allowed,
}) {
  const content = (
    <>
      <div className="equipment-command__card-heading">
        <span className="equipment-command__card-icon" aria-hidden="true">
          {icon}
        </span>
        <span className={`equipment-command__access ${allowed ? "is-allowed" : "is-restricted"}`}>
          {allowed ? "Available to this account" : "Not assigned to this account"}
        </span>
      </div>

      <div className="equipment-command__card-copy">
        <small>{label}</small>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>

      <ul>
        {features.map((feature) => (
          <li key={feature}>
            <span aria-hidden="true">✓</span>
            {feature}
          </li>
        ))}
      </ul>

      <div className="equipment-command__card-action">
        <strong>{allowed ? `Open ${title}` : "This role belongs to the other division"}</strong>
        <span aria-hidden="true">→</span>
      </div>
    </>
  );

  if (!allowed) {
    return (
      <article
        className={`equipment-command__card is-${tone} is-disabled`}
        aria-disabled="true"
      >
        {content}
      </article>
    );
  }

  return (
    <Link className={`equipment-command__card is-${tone}`} to={route}>
      {content}
    </Link>
  );
}

export default function EquipmentDivisionGatewayPage() {
  const auth = useAuth();
  const { isLoggedIn, workspaceCode, user, logout } = auth;
  const [leaving, setLeaving] = useState(false);
  const [navigationError, setNavigationError] = useState("");

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
  const roleName = String(user?.workspace_role || user?.role || "staff")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

  async function backToLogin() {
    if (leaving) return;
    setLeaving(true);
    setNavigationError("");

    try {
      await logout();
      window.location.replace("/login?workspace=equipment_hire");
    } catch {
      setNavigationError("The session could not be closed cleanly. Please try again.");
      setLeaving(false);
    }
  }

  return (
    <main className="equipment-command">
      <header className="equipment-command__topbar">
        <div className="equipment-command__brand">
          <img src="/chalin03-logo.png" alt="Chalin 03 Company Limited" />
          <span>
            <small>Chalin 03 Company Limited</small>
            <strong>Equipment Business</strong>
          </span>
        </div>

        <div className="equipment-command__top-actions">
          <div className="equipment-command__identity">
            <span className="equipment-command__status-dot" aria-hidden="true" />
            <span>
              <small>Secure staff session</small>
              <strong>{displayName}</strong>
              <em>{roleName}</em>
            </span>
          </div>

          <EquipmentDivisionStaffManager user={user} />

          <button
            type="button"
            className="equipment-command__logout"
            onClick={backToLogin}
            disabled={leaving}
          >
            {leaving ? "Closing session…" : "Back to Login"}
          </button>
        </div>
      </header>

      <section className="equipment-command__intro">
        <div>
          <p className="equipment-command__eyebrow">Equipment Business gateway</p>
          <h1>Choose the division you are opening.</h1>
          <p>
            Hire and Finance are independent businesses. Your staff role decides which
            workspace you may enter, while the System Administrator can supervise both.
          </p>
        </div>

        <aside>
          <span aria-hidden="true">🛡️</span>
          <p>
            <strong>Protected division boundary</strong>
            Hire jobs never become Finance accounts, and Finance accounts never become
            Hire operations.
          </p>
        </aside>
      </section>

      {navigationError ? (
        <div className="equipment-command__notice" role="alert">
          {navigationError}
        </div>
      ) : null}

      <section className="equipment-command__grid" aria-label="Equipment Business divisions">
        <DivisionCard
          tone="hire"
          icon="🏗️"
          label="Hire staff division"
          title="Equipment Hire Operations"
          description="Temporary equipment use, customer Hire work, dispatch, billing, returns and fleet control."
          features={hireFeatures}
          route="/equipment-hire-operations?division=hire"
          allowed={canOpenHire}
        />

        <DivisionCard
          tone="finance"
          icon="🏦"
          label="Finance staff division"
          title="Equipment Installment Finance"
          description="Credit purchase applications, installment accounts, collections, delivery and ownership."
          features={financeFeatures}
          route="/equipment-installment-finance"
          allowed={canOpenFinance}
        />
      </section>

      <section className="equipment-command__footer-actions">
        <button type="button" onClick={backToLogin} disabled={leaving}>
          Back to Equipment Login
        </button>
      </section>
    </main>
  );
}
