import { useEffect, useMemo, useState } from "react";
import { contentStudioErrorMessage } from "./contentStudioApi";
import { getContentStudioPublicAnalytics } from "./contentStudioAnalyticsApi";
import "./contentStudioPublicAnalytics.css";

const PERIODS = Object.freeze([7, 30, 90]);

function formatCount(value) {
  return new Intl.NumberFormat("en-GH").format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GH", { day: "2-digit", month: "short", year: "numeric" });
}

export default function ContentStudioPublicAnalytics() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    getContentStudioPublicAnalytics(days, { signal: controller.signal })
      .then((next) => {
        if (!controller.signal.aborted) setData(next || {});
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) setError(contentStudioErrorMessage(requestError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [days]);

  const trend = Array.isArray(data.trend) ? data.trend : [];
  const topRoutes = Array.isArray(data.top_routes) ? data.top_routes : [];
  const maxDaily = useMemo(
    () => Math.max(1, ...trend.map((item) => Number(item.page_views || 0))),
    [trend]
  );
  const privacy = data.privacy || {};
  const totals = data.totals || {};

  return (
    <section className="cs-pa-shell">
      <header className="cs-pa-header">
        <div>
          <span>PUBLIC TRUST / AGGREGATE ANALYTICS</span>
          <h1>See which public pages are being used—without building visitor profiles.</h1>
          <p>CHALIN ONE stores daily public-route totals only. Staff activity, form contents, raw IPs, user agents, cookies and visitor IDs stay outside this analytics dataset.</p>
        </div>
        <div className="cs-pa-periods" aria-label="Analytics reporting period">
          {PERIODS.map((period) => (
            <button
              type="button"
              key={period}
              className={days === period ? "is-active" : ""}
              onClick={() => setDays(period)}
            >
              {period} days
            </button>
          ))}
        </div>
      </header>

      {loading ? <div className="cs-pa-state" role="status">Loading aggregate public analytics…</div> : null}
      {error ? <div className="cs-pa-state is-error" role="alert">{error}</div> : null}

      {!loading && !error ? (
        <>
          <div className="cs-pa-scorecards">
            <article>
              <span>PAGE VIEWS</span>
              <strong>{formatCount(totals.page_views)}</strong>
              <small>Across the selected {data.days || days}-day window</small>
            </article>
            <article>
              <span>PUBLIC ROUTES</span>
              <strong>{formatCount(totals.public_routes)}</strong>
              <small>Published paths seen in aggregate analytics</small>
            </article>
            <article>
              <span>ACTIVE DAYS</span>
              <strong>{formatCount(trend.length)}</strong>
              <small>{formatDate(totals.first_metric_date)} → {formatDate(totals.last_metric_date)}</small>
            </article>
          </div>

          <div className="cs-pa-layout">
            <section className="cs-pa-panel">
              <header>
                <div>
                  <span>DAILY SIGNAL</span>
                  <h2>Public page-view trend</h2>
                </div>
                <small>Aggregate only</small>
              </header>
              {trend.length > 0 ? (
                <div className="cs-pa-trend" aria-label="Daily aggregate page views">
                  {trend.map((item) => {
                    const views = Number(item.page_views || 0);
                    return (
                      <div className="cs-pa-trend-row" key={String(item.metric_date)}>
                        <time>{formatDate(item.metric_date)}</time>
                        <div><i style={{ width: `${Math.max(2, (views / maxDaily) * 100)}%` }} /></div>
                        <strong>{formatCount(views)}</strong>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="cs-pa-empty">No aggregate page views have been recorded in this period yet.</p>
              )}
            </section>

            <section className="cs-pa-panel">
              <header>
                <div>
                  <span>TOP PUBLIC ROUTES</span>
                  <h2>Where visitors are going</h2>
                </div>
                <small>Max 50 routes</small>
              </header>
              {topRoutes.length > 0 ? (
                <div className="cs-pa-routes">
                  {topRoutes.map((item, index) => (
                    <article key={item.route_path}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <strong>{item.route_path}</strong>
                        <small>{formatDate(item.first_metric_date)} → {formatDate(item.last_metric_date)}</small>
                      </div>
                      <b>{formatCount(item.page_views)}</b>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="cs-pa-empty">Route rankings will appear after public page views are recorded.</p>
              )}
            </section>
          </div>

          <section className="cs-pa-privacy">
            <div>
              <span>PRIVACY CONTRACT</span>
              <h2>The analytics table is intentionally unable to identify a visitor.</h2>
              <p>This is a technical boundary, not merely a dashboard filter. The aggregate table has no columns for identities, network addresses, browser fingerprints or form responses.</p>
            </div>
            <div className="cs-pa-privacy-grid">
              {[
                ["Raw IP stored", privacy.stores_raw_ip],
                ["User agent stored", privacy.stores_user_agent],
                ["Cookie ID stored", privacy.stores_cookie_id],
                ["Visitor ID stored", privacy.stores_visitor_id],
                ["Form content stored", privacy.stores_form_content],
                ["Staff activity stored", privacy.stores_staff_activity],
              ].map(([label, value]) => (
                <article key={label} className={value ? "is-danger" : "is-safe"}>
                  <span>{value ? "YES" : "NO"}</span>
                  <strong>{label}</strong>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}
