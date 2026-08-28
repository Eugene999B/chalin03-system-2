import { useEffect, useMemo, useState } from "react";
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

function StartGuide({ portalTarget }) {
  const [progress, setProgress] = useState({ done: 0, total: 0, percent: 0 });
  const [active, setActive] = useState(0);

  useEffect(() => {
    const root = document.querySelector(".finance-profile");
    if (!root) return undefined;
    const sections = [...root.querySelectorAll(".finance-profile__section")];

    const update = () => {
      const values = sections.map((section) => {
        const fields = [...section.querySelectorAll("input,select,textarea")].filter((el) => el.type !== "hidden");
        if (!fields.length) return false;
        return fields.every((el) => el.type === "checkbox" ? el.checked : String(el.value || "").trim() !== "");
      });
      const done = values.filter(Boolean).length;
      const total = values.length || 1;
      setProgress({ done, total, percent: Math.round((done / total) * 100) });
      const viewport = window.innerHeight || 900;
      let nearest = 0;
      let distance = Number.POSITIVE_INFINITY;
      sections.forEach((section, index) => {
        const value = Math.abs(section.getBoundingClientRect().top - viewport * 0.22);
        if (value < distance) { distance = value; nearest = index; }
      });
      setActive(nearest);
    };

    update();
    root.addEventListener("input", update, true);
    root.addEventListener("change", update, true);
    window.addEventListener("scroll", update, { passive: true });
    const timer = window.setInterval(update, 1000);
    return () => {
      root.removeEventListener("input", update, true);
      root.removeEventListener("change", update, true);
      window.removeEventListener("scroll", update);
      window.clearInterval(timer);
    };
  }, []);

  const labels = useMemo(() => {
    const root = document.querySelector(".finance-profile");
    return root ? [...root.querySelectorAll(".finance-profile__section h3")].map((node, index) => node.textContent?.trim() || `Step ${index + 1}`) : [];
  }, [portalTarget]);

  return (
    <div className="c03-ifx-start">
      <div className="c03-ifx-start__summary">
        <div>
          <span className="c03-ifx-kicker">Guided application</span>
          <strong>{progress.percent}% ready</strong>
          <small>{progress.done} of {progress.total} sections complete</small>
        </div>
        <div className="c03-ifx-progress" aria-label={`${progress.percent}% complete`}>
          <span style={{ width: `${progress.percent}%` }} />
        </div>
      </div>
      <div className="c03-ifx-tasklist" aria-label="Installment application steps">
        {labels.map((label, index) => (
          <button
            type="button"
            key={`${label}-${index}`}
            className={index === active ? "is-current" : index < progress.done ? "is-done" : ""}
            onClick={() => document.querySelectorAll(".finance-profile__section")[index]?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            <span>{index + 1}</span>
            <strong>{label}</strong>
            <small>{index < progress.done ? "Complete" : index === active ? "Current" : "Pending"}</small>
          </button>
        ))}
      </div>
      <div className="c03-ifx-hints">
        <span><b>Best path:</b> customer → equipment → terms → review → save.</span>
        <button type="button" onClick={() => clickExisting(".finance-profile", /save.*profile/i)}>Save customer profile</button>
        <Link to={`${BASE}/applications?stage=machines`}>Choose excavator</Link>
        <Link to={`${BASE}/applications?stage=customer-portfolios`}>Open customer profile</Link>
      </div>
    </div>
  );
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

  const contextual = stage === "start"
    ? <StartGuide portalTarget={portalTarget} />
    : stage === "corrections"
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
