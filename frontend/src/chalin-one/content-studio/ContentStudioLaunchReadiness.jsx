import { useEffect, useMemo, useState } from "react";
import {
  PUBLIC_RELEASE_SMOKE_PATHS,
} from "../chalinOnePathModel.js";
import {
  formatBudgetBytes,
  PUBLIC_PERFORMANCE_BASELINE,
  PUBLIC_PERFORMANCE_BUDGETS,
} from "../publicPerformanceBudgetModel.js";
import { getContentStudioLaunchReadiness } from "./contentStudioLaunchReadinessApi.js";
import "./contentStudioLaunchReadiness.css";

function featureEnabled(signal, key) {
  const value = signal?.data?.flags?.[key];
  return value === true || value?.enabled === true;
}

function StatusCard({ label, ok, detail }) {
  return (
    <article className={`cs-lr-check ${ok ? "is-ready" : "is-attention"}`}>
      <span>{ok ? "READY" : "ATTENTION"}</span>
      <strong>{label}</strong>
      <p>{detail}</p>
    </article>
  );
}

export default function ContentStudioLaunchReadiness() {
  const [signals, setSignals] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    getContentStudioLaunchReadiness({ signal: controller.signal })
      .then((next) => {
        if (!controller.signal.aborted) setSignals(next);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const checks = useMemo(() => {
    if (!signals) return [];
    const apiReady = signals.readiness.ok && signals.readiness.data?.ready === true;
    const publicWebsiteEnabled =
      signals.publicFeatures.ok && featureEnabled(signals.publicFeatures, "publicWebsite");

    return [
      {
        label: "API and schema readiness",
        ok: apiReady,
        detail: apiReady
          ? "The current API readiness endpoint reports its database, schema and required configuration ready."
          : signals.readiness.error || "The readiness endpoint is not currently green.",
      },
      {
        label: "Public website feature gate",
        ok: publicWebsiteEnabled,
        detail: publicWebsiteEnabled
          ? "The publicWebsite feature gate is enabled for this environment."
          : "The public website feature gate is disabled or could not be verified.",
      },
      {
        label: "Protected Content Studio surface",
        ok: signals.studioDashboard.ok,
        detail: signals.studioDashboard.ok
          ? "The authenticated Content Studio dashboard is reachable through the protected Studio route."
          : signals.studioDashboard.error || "The protected Content Studio dashboard could not be verified.",
      },
      {
        label: "Governed Page Manager",
        ok: signals.studioPages.ok,
        detail: signals.studioPages.ok
          ? "The protected governed Pages API is reachable for this Studio identity."
          : signals.studioPages.error || "The governed Pages surface could not be verified.",
      },
      {
        label: "Website Control Center",
        ok: signals.websiteControl.ok,
        detail: signals.websiteControl.ok
          ? "The read-only Website Control intelligence surface is reachable."
          : signals.websiteControl.error || "Website Control intelligence could not be verified.",
      },
      {
        label: "Published public bootstrap",
        ok: signals.publicBootstrap.ok,
        detail: signals.publicBootstrap.ok
          ? "The anonymous governed bootstrap endpoint is reachable."
          : signals.publicBootstrap.error || "Public bootstrap could not be loaded.",
      },
      {
        label: "Published homepage reflection",
        ok: signals.publicHomepage.ok,
        detail: signals.publicHomepage.ok
          ? "The currently published governed homepage is visible through the anonymous public API."
          : signals.publicHomepage.error || "The governed public homepage could not be loaded.",
      },
      {
        label: "Transparent data-use disclosure",
        ok: signals.analyticsDisclosure.ok,
        detail: signals.analyticsDisclosure.ok
          ? "The public analytics/data-use disclosure endpoint is reachable."
          : signals.analyticsDisclosure.error || "Data-use disclosure could not be loaded.",
      },
    ];
  }, [signals]);

  const readyCount = checks.filter((item) => item.ok).length;
  const allReady = checks.length > 0 && readyCount === checks.length;

  return (
    <section className="cs-lr-shell">
      <header className="cs-lr-hero">
        <div>
          <span>PHASE 2K / CONTENT STUDIO COMPLETION CONTROL</span>
          <h1>Final acceptance desk for the governed Content Studio.</h1>
          <p>
            This desk is read-only. It combines live staging signals with the public build contract
            while Phase 2K CI proves the complete Editor → Reviewer → Publisher lifecycle, blocks
            self-approval, prevents draft content from leaking publicly and confirms that publishing
            changes the anonymous website only after independent approval.
          </p>
        </div>
        <div className={`cs-lr-score ${allReady ? "is-ready" : "is-attention"}`}>
          <strong>{loading ? "…" : `${readyCount}/${checks.length || 8}`}</strong>
          <span>{allReady ? "LIVE STUDIO SIGNALS READY" : "LIVE SIGNALS TO REVIEW"}</span>
        </div>
      </header>

      <div className="cs-lr-checks" aria-live="polite">
        {loading ? <div className="cs-lr-loading">Reading final Studio readiness signals…</div> : null}
        {!loading ? checks.map((item) => <StatusCard key={item.label} {...item} />) : null}
      </div>

      <div className="cs-lr-grid">
        <section className="cs-lr-panel">
          <header>
            <span>BUILD-TIME PERFORMANCE CONTRACT</span>
            <h2>Public boot cannot quietly grow back into the Staff bundle.</h2>
          </header>
          <div className="cs-lr-budget-grid">
            <article><span>INITIAL ENTRY JS</span><strong>≤ {formatBudgetBytes(PUBLIC_PERFORMANCE_BUDGETS.entry_js_bytes)}</strong></article>
            <article><span>PUBLIC ENTRY JS</span><strong>≤ {formatBudgetBytes(PUBLIC_PERFORMANCE_BUDGETS.public_entry_js_bytes)}</strong></article>
            <article><span>PUBLIC APP JS</span><strong>≤ {formatBudgetBytes(PUBLIC_PERFORMANCE_BUDGETS.public_app_js_bytes)}</strong></article>
            <article><span>PUBLIC APP CSS</span><strong>≤ {formatBudgetBytes(PUBLIC_PERFORMANCE_BUDGETS.public_app_css_bytes)}</strong></article>
            <article><span>CRITICAL PUBLIC JS</span><strong>≤ {formatBudgetBytes(PUBLIC_PERFORMANCE_BUDGETS.public_critical_js_bytes)}</strong></article>
            <article><span>CRITICAL PUBLIC CSS</span><strong>≤ {formatBudgetBytes(PUBLIC_PERFORMANCE_BUDGETS.public_critical_css_bytes)}</strong></article>
          </div>
          <p className="cs-lr-baseline">
            Phase 2J baseline before splitting: {formatBudgetBytes(PUBLIC_PERFORMANCE_BASELINE.previous_entry_js_bytes)} shared entry JS. The postbuild gate also requires at least a 60% reduction from that baseline.
          </p>
        </section>

        <section className="cs-lr-panel">
          <header>
            <span>PUBLIC ROUTE SMOKE INVENTORY</span>
            <h2>Core visitor paths that must remain inside the public application.</h2>
          </header>
          <div className="cs-lr-routes">
            {PUBLIC_RELEASE_SMOKE_PATHS.map((route) => (
              <code key={route}>{route}</code>
            ))}
          </div>
        </section>
      </div>

      <section className="cs-lr-gate">
        <div>
          <span>PHASE 2K COMPLETION RULE</span>
          <h2>Content Studio is complete only when governance and staging agree.</h2>
          <p>
            The automated Phase 2K database acceptance uses separate author, reviewer and publisher
            identities. It proves that drafts and approved-but-unpublished replacements cannot replace
            live content, then verifies that the exact independently approved version becomes public.
            The aggregate CHALIN ONE CI summary is the machine-readable go/no-go record. The exact
            merged commit must then pass protected Railway and Cloudflare Pages staging before Studio
            is declared complete. Production backup and promotion remain separate later phases.
          </p>
        </div>
        <div>
          <strong>1</strong><span>Editor → Reviewer → Publisher lifecycle green</span>
          <strong>2</strong><span>Self-approval and wrong-reviewer paths blocked</span>
          <strong>3</strong><span>Draft and approved replacements stay private</span>
          <strong>4</strong><span>Published version reflected on the public API</span>
          <strong>5</strong><span>Full frontend/backend/MySQL CI green</span>
          <strong>6</strong><span>Railway + Cloudflare staging green</span>
        </div>
      </section>
    </section>
  );
}
