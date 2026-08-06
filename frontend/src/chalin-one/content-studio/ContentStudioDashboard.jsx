import {
  formatContentStudioCount,
  normalizeContentStudioDashboard,
} from "./contentStudioModel";

function MetricCard({ label, value, detail, tone = "blue" }) {
  return (
    <article className={`cs-metric cs-tone-${tone}`}>
      <span className="cs-metric-label">{label}</span>
      <strong className="cs-metric-value">{formatContentStudioCount(value)}</strong>
      <span className="cs-metric-detail">{detail}</span>
    </article>
  );
}

function QueueRow({ label, value, description, tone }) {
  return (
    <div className="cs-queue-row">
      <span className={`cs-queue-dot cs-dot-${tone}`} aria-hidden="true" />
      <div>
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
      <b>{formatContentStudioCount(value)}</b>
    </div>
  );
}

export default function ContentStudioDashboard({
  dashboard,
  sections,
  onOpenSection,
  loading,
  error,
  onRetry,
}) {
  const metrics = normalizeContentStudioDashboard(dashboard);

  return (
    <div className="cs-dashboard" aria-busy={loading ? "true" : "false"}>
      <section className="cs-hero">
        <div>
          <span className="cs-eyebrow">CHALIN ONE</span>
          <h2>Website command centre</h2>
          <p>
            Prepare content, review exact saved versions and publish only after
            approved governance checks.
          </p>
        </div>
        <div className="cs-hero-state">
          <span className="cs-live-dot" aria-hidden="true" />
          <div>
            <strong>Protected workspace</strong>
            <span>Feature flag, authentication and permissions active</span>
          </div>
        </div>
      </section>

      {error ? (
        <div className="cs-alert cs-alert-danger" role="alert">
          <div>
            <strong>Dashboard could not be refreshed</strong>
            <span>{error}</span>
          </div>
          <button type="button" onClick={onRetry}>Try again</button>
        </div>
      ) : null}

      <section className="cs-metric-grid" aria-label="Content Studio totals">
        <MetricCard
          label="Published pages"
          value={metrics.pages.published}
          detail={`${formatContentStudioCount(metrics.pages.total)} total pages`}
          tone="blue"
        />
        <MetricCard
          label="Pending approvals"
          value={metrics.approvals.pending}
          detail="Exact versions waiting for review"
          tone="orange"
        />
        <MetricCard
          label="New enquiries"
          value={metrics.submissions.new}
          detail={`${formatContentStudioCount(metrics.submissions.inReview)} being reviewed`}
          tone="orange"
        />
        <MetricCard
          label="Ready media"
          value={metrics.media.ready}
          detail={`${formatContentStudioCount(metrics.media.total)} total assets`}
          tone="green"
        />
      </section>

      <div className="cs-dashboard-columns">
        <section className="cs-panel">
          <div className="cs-panel-heading">
            <div>
              <span className="cs-eyebrow">Work queues</span>
              <h3>Attention required</h3>
            </div>
          </div>
          <div className="cs-queue-list">
            <QueueRow
              label="Draft pages"
              value={metrics.pages.draft}
              description="Content still being prepared"
              tone="warning"
            />
            <QueueRow
              label="Pages in review"
              value={metrics.pages.inReview}
              description="Submitted for independent review"
              tone="warning"
            />
            <QueueRow
              label="Pending media"
              value={metrics.media.pending}
              description="Processing or verification outstanding"
              tone="warning"
            />
            <QueueRow
              label="Quarantined media"
              value={metrics.media.quarantined}
              description="Blocked from public use"
              tone="danger"
            />
          </div>
        </section>

        <section className="cs-panel">
          <div className="cs-panel-heading">
            <div>
              <span className="cs-eyebrow">Your tools</span>
              <h3>Open a manager</h3>
            </div>
          </div>
          <div className="cs-quick-grid">
            {sections.slice(0, 8).map((section) => (
              <button
                type="button"
                className="cs-quick-card"
                key={section.key}
                onClick={() => onOpenSection(section.key)}
              >
                <span className={`cs-badge cs-badge-${section.tone}`} aria-hidden="true">
                  {section.badge}
                </span>
                <span>
                  <strong>{section.label}</strong>
                  <small>{section.description}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
