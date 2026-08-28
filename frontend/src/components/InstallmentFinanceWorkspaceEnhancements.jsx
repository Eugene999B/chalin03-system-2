import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router";
import "../styles/installmentFinanceWorkspaceEnhancements.css";

const BASE = "/equipment-installment-finance";

const primaryLinks = [
  { label: "Finance Home", href: BASE, icon: "⌂" },
  { label: "New Installment", href: `${BASE}/applications?stage=start`, icon: "+" },
  { label: "Applications", href: `${BASE}/applications`, icon: "▣" },
  { label: "Customer Profiles", href: `${BASE}/applications?stage=customer-portfolios`, icon: "◉" },
  { label: "Corrections", href: `${BASE}/applications?stage=corrections`, icon: "↩" },
];

function getStage(location) {
  if (location.pathname !== `${BASE}/applications`) return "home";
  return new URLSearchParams(location.search).get("stage") || "applications";
}

function routeIsFinance(location) {
  return location.pathname === BASE || location.pathname.startsWith(`${BASE}/`);
}

function pageTitle(stage) {
  return {
    home: "Finance control centre",
    start: "Start a new installment",
    applications: "Applications & approvals",
    "customer-portfolios": "Customer installment profiles",
    corrections: "Corrections & reversals",
    machines: "Excavator availability",
    collections: "Payments & collections",
    accounts: "Active installments",
    arrears: "Payments & arrears",
    inbox: "Task & approval inbox",
  }[stage] || "Installment finance";
}

function clickExisting(selector, textPattern) {
  const root = document.querySelector(selector);
  if (!root) return false;
  const nodes = [...root.querySelectorAll("button,a")];
  const target = nodes.find((node) => textPattern.test((node.textContent || "").trim()));
  if (!target) return false;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.focus?.();
  return true;
}

function CorrectionsGuide() {
  return (
    <div className="c03-ifx-corrections">
      <div className="c03-ifx-corrections__hero">
        <div>
          <span className="c03-ifx-kicker">Controlled accounting workflow</span>
          <strong>Correct the record without rewriting history.</strong>
          <small>Work in this order: find agreement → document reason/evidence → preview impact → submit → independent decision → ledger review.</small>
        </div>
        <div className="c03-ifx-corrections__actions">
          <button type="button" onClick={() => clickExisting(".finance-corrections", /search correction accounts|agreement, customer or excavator/i)}>Find an agreement</button>
          <button type="button" onClick={() => clickExisting(".finance-corrections", /new correction|record correction|submit/i)}>New correction</button>
        </div>
      </div>
      <div className="c03-ifx-rulegrid">
        <article><b>01</b><strong>Evidence first</strong><span>Keep the reason and evidence reference beside the request so a reviewer can understand it without hunting.</span></article>
        <article><b>02</b><strong>Preview before approval</strong><span>Confirm the expected balance, refund and charges before the request becomes a decision item.</span></article>
        <article><b>03</b><strong>Separate preparation from decision</strong><span>The preparer records the case; the authorised decision maker approves or rejects it.</span></article>
        <article><b>04</b><strong>Ledger is authoritative</strong><span>Original receipts remain intact; corrections are additive and traceable.</span></article>
      </div>
    </div>
  );
}

function CustomerGuide() {
  const focusSearch = () => {
    const field = document.querySelector('input[aria-label="Search Finance customers"]');
    field?.focus();
    field?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const setStatus = (value) => {
    const field = document.querySelector('select[aria-label="Filter customer portfolio status"]');
    if (field) {
      field.value = value;
      field.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  return (
    <div className="c03-ifx-customer">
      <div className="c03-ifx-customer__head">
        <div><span className="c03-ifx-kicker">Portfolio command view</span><strong>Find the customer, then act from the customer file.</strong><small>Prioritise exposure and overdue risk before opening detailed schedules.</small></div>
        <div className="c03-ifx-customer__actions">
          <button type="button" onClick={focusSearch}>Search customer</button>
          <button type="button" onClick={() => setStatus("overdue")}>Overdue only</button>
          <button type="button" onClick={() => setStatus("active")}>Active only</button>
          <Link to={`${BASE}/applications?stage=start`}>New installment</Link>
        </div>
      </div>
      <div className="c03-ifx-customer__signals">
        <span><b>Priority</b> overdue exposure and active agreements</span>
        <span><b>Profile</b> agreements, payments, schedule and KYC</span>
        <span><b>Action</b> payment, account, history or new installment</span>
      </div>
    </div>
  );
}

export default function InstallmentFinanceWorkspaceEnhancements() {
  const location = useLocation();
  const [portalTarget, setPortalTarget] = useState(null);
  const stage = getStage(location);

  useEffect(() => {
    if (!routeIsFinance(location)) return undefined;
    const timer = window.setTimeout(() => setPortalTarget(document.querySelector(".bwl-content")), 0);
    return () => window.clearTimeout(timer);
  }, [location.pathname, location.search]);

  if (!routeIsFinance(location) || !portalTarget) return null;

  const contextual = stage === "corrections"
    ? <CorrectionsGuide />
    : stage === "customer-portfolios"
      ? <CustomerGuide />
      : null;

  return createPortal(
    <div className="c03-ifx-root" data-c03-ifx-stage={stage}>
      <nav className="c03-ifx-nav" aria-label="Finance quick navigation">
        <div className="c03-ifx-nav__identity"><span>🏦</span><div><b>Installment Finance</b><small>{pageTitle(stage)}</small></div></div>
        <div className="c03-ifx-nav__links">
          {primaryLinks.map((item) => (
            <Link key={item.label} to={item.href}><span aria-hidden="true">{item.icon}</span>{item.label}</Link>
          ))}
        </div>
        <span className="c03-ifx-nav__status">● Secure finance workspace</span>
      </nav>
      {contextual}
    </div>,
    portalTarget
  );
}
