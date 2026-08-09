import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { contentStudioErrorMessage } from "./contentStudioApi";
import {
  getPage,
  listPages,
  publishPageVersion,
} from "./contentStudioPageApi";
import {
  getNewsroomEntity,
  listNewsroomEntities,
  publishNewsroomVersion,
} from "./contentStudioNewsroomApi";
import {
  getPortfolioEntity,
  listPortfolioEntities,
  publishPortfolioVersion,
} from "./contentStudioPortfolioApi";
import { listAllApprovals } from "./contentStudioOperationsApi";
import { CONTENT_STUDIO_PERMISSIONS } from "./contentStudioModel";
import {
  PUBLISHER_RELEASE_SOURCES,
  buildPublisherTimeline,
  normalizePublisherApprovals,
  normalizePublisherRelease,
  publisherCommandSummary,
  releaseSchedulePayload,
  selectApprovedReleaseVersion,
} from "./contentStudioPublisherCommandModel";
import "./contentStudioPublisherCommandCenter.css";

function statusLabel(value) {
  return String(value || "draft").replaceAll("_", " ");
}

function displayDate(value, fallback = "Not scheduled") {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-GH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function inputDateTime(date = null) {
  const value = date instanceof Date ? date : date ? new Date(date) : null;
  if (!value || Number.isNaN(value.getTime())) return "";
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function itemTitle(item) {
  return item?.title || `${item?.label || "Release"} #${item?.id || ""}`;
}

function sourceLabel(item) {
  return PUBLISHER_RELEASE_SOURCES.find((source) => source.key === item?.source)?.label || item?.source || "Release";
}

function scheduledPageVersion(details = {}) {
  const versions = Array.isArray(details?.versions) ? details.versions : [];
  return versions.find((version) => String(version?.version_status || "").toLowerCase() === "scheduled") || null;
}

async function loadReleaseSource(source, { signal } = {}) {
  if (source === "page") {
    const result = await listPages({ limit: 100, offset: 0 }, { signal });
    const rows = Array.isArray(result?.items) ? result.items : [];
    return Promise.all(rows.map(async (row) => {
      if (String(row.latest_version_status || "").toLowerCase() !== "scheduled") return row;
      try {
        const details = await getPage(row.id, { signal });
        if (signal?.aborted) return row;
        const scheduledVersion = scheduledPageVersion(details);
        if (!scheduledVersion) return row;
        return {
          ...row,
          publish_at: scheduledVersion.publish_at || row.publish_at,
          expires_at: scheduledVersion.expires_at || null,
          scheduled_candidate_version_id: scheduledVersion.id,
          scheduled_candidate_version_number: scheduledVersion.version_number,
        };
      } catch (error) {
        if (signal?.aborted) throw error;
        return row;
      }
    }));
  }
  if (source === "article" || source === "announcement") {
    const result = await listNewsroomEntities(source, { limit: 100, offset: 0 }, { signal });
    return Array.isArray(result?.items) ? result.items : [];
  }
  const result = await listPortfolioEntities(source, { limit: 100, offset: 0 }, { signal });
  return Array.isArray(result?.items) ? result.items : [];
}

async function loadReleaseDetails(item, { signal } = {}) {
  if (item.source === "page") return getPage(item.id, { signal });
  if (item.source === "article" || item.source === "announcement") {
    return getNewsroomEntity(item.source, item.id, { signal });
  }
  return getPortfolioEntity(item.source, item.id, { signal });
}

async function executePublish(item, versionId, payload = {}) {
  if (item.source === "page") return publishPageVersion(item.id, versionId, payload);
  if (item.source === "article" || item.source === "announcement") {
    return publishNewsroomVersion(item.source, item.id, versionId, payload);
  }
  return publishPortfolioVersion(item.source, item.id, versionId, payload);
}

function Score({ label, value, note, tone = "" }) {
  return (
    <article className={`cs-pc-score ${tone ? `is-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function Timeline({ days, collisions }) {
  return (
    <section className="cs-pc-timeline-panel">
      <header>
        <div><span>21-DAY RELEASE TIMELINE</span><strong>Upcoming website changes</strong></div>
        <small>Publication and expiry events</small>
      </header>
      <div className="cs-pc-timeline">
        {days.map((day) => (
          <article key={day.dayKey} className="cs-pc-day">
            <div className="cs-pc-day-label">
              <strong>{new Date(`${day.dayKey}T12:00:00`).toLocaleDateString("en-GH", { weekday: "short", day: "numeric", month: "short" })}</strong>
              <span>{day.events.length} event{day.events.length === 1 ? "" : "s"}</span>
            </div>
            <div className="cs-pc-day-events">
              {day.events.map((event) => (
                <div key={`${event.type}-${event.item.key}-${event.at.toISOString()}`} className={`cs-pc-event is-${event.type}${collisions.has(event.item.key) && event.type === "publish" ? " has-collision" : ""}`}>
                  <span>{event.type === "publish" ? "LIVE" : "END"}</span>
                  <div>
                    <strong>{itemTitle(event.item)}</strong>
                    <small>{sourceLabel(event.item)} · {event.at.toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit" })}</small>
                  </div>
                  {collisions.has(event.item.key) && event.type === "publish" ? <b>COLLISION</b> : null}
                </div>
              ))}
            </div>
          </article>
        ))}
        {!days.length ? <div className="cs-pc-empty"><strong>No scheduled release events in the next 21 days.</strong><span>Approved Pages can be scheduled from this command centre.</span></div> : null}
      </div>
    </section>
  );
}

export default function ContentStudioPublisherCommandCenter({ onOpenSection }) {
  const auth = useAuth();
  const canPublish = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.publish);
  const [items, setItems] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [unavailable, setUnavailable] = useState([]);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedKey, setSelectedKey] = useState(null);
  const [details, setDetails] = useState(null);
  const [publishAt, setPublishAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selected = useMemo(() => items.find((item) => item.key === selectedKey) || null, [items, selectedKey]);
  const approvedVersion = useMemo(() => selectApprovedReleaseVersion(details || {}), [details]);
  const now = useMemo(() => new Date(), [items, approvals]);
  const summary = useMemo(() => publisherCommandSummary(items, approvals, now), [items, approvals, now]);
  const timeline = useMemo(() => buildPublisherTimeline(items, now, 21), [items, now]);
  const normalizedApprovals = useMemo(() => normalizePublisherApprovals(approvals, now), [approvals, now]);
  const filtered = useMemo(() => items.filter((item) => {
    if (sourceFilter && item.source !== sourceFilter) return false;
    if (statusFilter) {
      const approvedCandidate = statusFilter === "approved" && item.latestVersionStatus === "approved";
      if (item.status !== statusFilter && !approvedCandidate) return false;
    }
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return `${item.title} ${item.subtitle} ${item.label}`.toLowerCase().includes(needle);
  }), [items, search, sourceFilter, statusFilter]);

  const scheduleSupported = Boolean(
    selected &&
    selected.source === "page" &&
    selected.status !== "scheduled" &&
    approvedVersion
  );
  const futureScheduleUnavailable = Boolean(selected && selected.source !== "page" && approvedVersion);

  const load = useCallback(async ({ signal } = {}) => {
    setLoading(true);
    setError("");
    try {
      const releaseResults = await Promise.allSettled(
        PUBLISHER_RELEASE_SOURCES.map(async (definition) => ({
          definition,
          rows: await loadReleaseSource(definition.key, { signal }),
        }))
      );
      if (signal?.aborted) return;
      const nextItems = releaseResults.flatMap((result) => {
        if (result.status !== "fulfilled") return [];
        return result.value.rows.map((row) => normalizePublisherRelease(result.value.definition.key, row)).filter(Boolean);
      });
      const unavailableSources = releaseResults
        .map((result, index) => result.status === "rejected" ? PUBLISHER_RELEASE_SOURCES[index].label : null)
        .filter(Boolean);
      const approvalResult = await listAllApprovals({ limit: 100, offset: 0 }, { signal });
      if (signal?.aborted) return;
      setItems(nextItems);
      setApprovals(Array.isArray(approvalResult?.items) ? approvalResult.items : []);
      setUnavailable([...unavailableSources, ...(approvalResult?.unavailable_sources || []).map((source) => `Approvals: ${source}`)]);
      setSelectedKey((current) => current && nextItems.some((item) => item.key === current) ? current : null);
    } catch (requestError) {
      if (!signal?.aborted) setError(contentStudioErrorMessage(requestError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  const openRelease = useCallback(async (item, { signal } = {}) => {
    setSelectedKey(item.key);
    setDetails(null);
    setPublishAt("");
    setExpiresAt("");
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const next = await loadReleaseDetails(item, { signal });
      if (signal?.aborted) return;
      setDetails(next);
      const version = selectApprovedReleaseVersion(next || {});
      setPublishAt(inputDateTime(version?.publish_at || null));
      setExpiresAt(inputDateTime(version?.expires_at || null));
    } catch (requestError) {
      if (!signal?.aborted) setError(contentStudioErrorMessage(requestError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load({ signal: controller.signal });
    return () => controller.abort();
  }, [load]);

  async function publishNow() {
    if (!selected || !approvedVersion || !canPublish || saving) return;
    if (!window.confirm(`Publish the exact approved version of “${selected.title}” now?`)) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await executePublish(selected, approvedVersion.id, {});
      setNotice(`${selected.title} was published through the governed approved-version workflow.`);
      setDetails(null);
      await load();
    } catch (requestError) {
      setError(contentStudioErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function scheduleRelease() {
    if (!selected || !approvedVersion || !scheduleSupported || !canPublish || saving) return;
    const schedule = releaseSchedulePayload(publishAt, expiresAt, new Date());
    if (!schedule.valid) {
      setError(schedule.error);
      return;
    }
    const replacingLivePage = selected.liveStatus === "published";
    const prompt = replacingLivePage
      ? `Schedule the approved replacement for “${selected.title}” at ${displayDate(schedule.payload.publish_at)} while keeping the current version live until handover?`
      : `Schedule “${selected.title}” for ${displayDate(schedule.payload.publish_at)}?`;
    if (!window.confirm(prompt)) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await executePublish(selected, approvedVersion.id, schedule.payload);
      setNotice(
        replacingLivePage
          ? `${selected.title} replacement is scheduled. The current published version stays live until the scheduler atomically promotes the approved replacement.`
          : `${selected.title} is scheduled. The public-content scheduler will promote the exact approved version when it becomes due.`
      );
      setDetails(null);
      await load();
    } catch (requestError) {
      setError(contentStudioErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="cs-pc-shell">
      <section className="cs-pc-hero">
        <div className="cs-pc-mark">PC</div>
        <div>
          <span>PUBLISHER COMMAND / PHASE 2F</span>
          <h2>One release desk for the public website.</h2>
          <p>See approved work, scheduled releases, collisions, expiries and overdue reviews before pressing the final governed publication controls.</p>
        </div>
        <div className="cs-pc-authority"><strong>PUBLISH AUTHORITY</strong><small>Approved versions only</small></div>
      </section>

      {error ? <div className="cs-pc-alert is-error" role="alert"><div><strong>Publisher action not completed</strong><span>{error}</span></div><button type="button" onClick={() => setError("")}>Close</button></div> : null}
      {notice ? <div className="cs-pc-alert" role="status"><div><strong>Publisher command completed</strong><span>{notice}</span></div><button type="button" onClick={() => setNotice("")}>Close</button></div> : null}
      {unavailable.length ? <div className="cs-pc-alert is-warning"><div><strong>Partial command view</strong><span>Unavailable sources: {unavailable.join(", ")}</span></div></div> : null}

      <section className="cs-pc-scores">
        <Score label="SCHEDULED" value={summary.scheduled} note="future release records" />
        <Score label="APPROVED" value={summary.approved} note="ready for publisher action" tone="ready" />
        <Score label="COLLISIONS" value={summary.collisions} note="within 60 minutes" tone={summary.collisions ? "warning" : ""} />
        <Score label="EXPIRING" value={summary.expiringSoon} note="within seven days" />
        <Score label="OVERDUE REVIEW" value={summary.overdueReviews} note="waiting 24+ hours" tone={summary.overdueReviews ? "warning" : ""} />
        <Score label="DUE / LATE" value={summary.dueOrLate} note="scheduler attention" tone={summary.dueOrLate ? "danger" : ""} />
      </section>

      <div className="cs-pc-grid">
        <section className="cs-pc-release-list">
          <header><div><span>RELEASE QUEUE</span><strong>{filtered.length} governed records</strong></div><button type="button" onClick={() => load()} disabled={loading}>Refresh</button></header>
          <div className="cs-pc-filters">
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search release queue" />
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
              <option value="">All release families</option>
              {PUBLISHER_RELEASE_SOURCES.map((source) => <option key={source.key} value={source.key}>{source.label}</option>)}
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">All statuses</option>
              <option value="approved">Approved candidate</option>
              <option value="scheduled">Scheduled</option>
              <option value="published">Published</option>
              <option value="in_review">In review</option>
              <option value="draft">Draft</option>
            </select>
          </div>
          <div className="cs-pc-records" aria-busy={loading ? "true" : "false"}>
            {filtered.map((item) => (
              <button type="button" key={item.key} className={selectedKey === item.key ? "is-active" : ""} onClick={() => openRelease(item)}>
                <span className="cs-pc-record-badge">{item.badge}</span>
                <span className="cs-pc-record-copy"><strong>{item.title}</strong><small>{item.subtitle || item.label}</small></span>
                <span className={`cs-pc-status is-${item.status}`}>{item.scheduledReplacement ? "scheduled replacement · live preserved" : item.latestVersionStatus === "approved" && item.status === "published" ? "published + approved candidate" : statusLabel(item.status)}</span>
                {item.publishAt ? <small className="cs-pc-record-date">{displayDate(item.publishAt)}</small> : null}
                {summary.collisionMap.has(item.key) ? <b className="cs-pc-collision">COLLISION</b> : null}
              </button>
            ))}
            {!filtered.length ? <div className="cs-pc-empty"><strong>No records match these filters.</strong><span>Change the source/status filters or refresh the command view.</span></div> : null}
          </div>
        </section>

        <section className="cs-pc-control-desk">
          {!selected ? (
            <div className="cs-pc-zero"><span>FINAL RELEASE CONTROL</span><strong>Select an approved or scheduled record.</strong><p>Publisher actions always target the exact approved version; this desk cannot approve its own work.</p></div>
          ) : (
            <>
              <div className="cs-pc-selected-head">
                <div><span>{selected.label.toUpperCase()} / #{selected.id}</span><h3>{selected.title}</h3><small>Release status: {statusLabel(selected.status)} · live record: {statusLabel(selected.liveStatus)} · candidate: {approvedVersion ? `v${approvedVersion.version_number || "?"} approved` : selected.latestVersionStatus === "scheduled" ? `v${selected.latestVersionNumber || "?"} scheduled` : "no approved version"}</small></div>
                <button type="button" onClick={() => onOpenSection?.(selected.manager)}>Open manager ↗</button>
              </div>

              <div className="cs-pc-live-window">
                <div><span>PUBLISH</span><strong>{displayDate(selected.publishAt)}</strong></div>
                <div><span>EXPIRE</span><strong>{displayDate(selected.expiresAt, "No automatic expiry")}</strong></div>
                <div><span>UPDATED</span><strong>{displayDate(selected.updatedAt, "Not recorded")}</strong></div>
              </div>

              {approvedVersion ? (
                <section className="cs-pc-approved-card">
                  <header><span>EXACT APPROVED VERSION</span><strong>v{approvedVersion.version_number || "?"}</strong></header>
                  <p>{approvedVersion.change_summary || "No change summary supplied."}</p>
                  <div className="cs-pc-publish-actions">
                    <button type="button" className="is-live" onClick={publishNow} disabled={!canPublish || saving}>{saving ? "Working…" : "Publish now"}</button>
                  </div>
                </section>
              ) : <div className="cs-pc-guidance"><strong>No approved version is available.</strong><span>Review and approval remain in Approval Inbox before the Publisher can schedule or publish.</span></div>}

              {scheduleSupported ? (
                <section className="cs-pc-scheduler-form">
                  <header><span>SAFE PAGE SCHEDULING</span><strong>{selected.liveStatus === "published" ? "Atomic scheduled replacement" : "First publication"}</strong></header>
                  <label><span>Go live</span><input type="datetime-local" value={publishAt} min={inputDateTime(new Date(Date.now() + 60000))} onChange={(event) => setPublishAt(event.target.value)} /></label>
                  <label><span>Automatic expiry <small>optional</small></span><input type="datetime-local" value={expiresAt} min={publishAt || inputDateTime(new Date(Date.now() + 60000))} onChange={(event) => setExpiresAt(event.target.value)} /></label>
                  <button type="button" onClick={scheduleRelease} disabled={!canPublish || saving || !publishAt}>Schedule approved version →</button>
                  <p>{selected.liveStatus === "published" ? "The current published Page stays live. At the due minute, the locked scheduler supersedes it and atomically promotes this exact approved replacement." : "The current server scheduler checks due public content every minute. Only the exact human-approved version is scheduled."}</p>
                </section>
              ) : null}

              {futureScheduleUnavailable ? <div className="cs-pc-guidance is-warning"><strong>Future scheduling is not enabled for this release family yet.</strong><span>Newsroom and Portfolio workflows explicitly reject future scheduling until their version-aware handover is accepted. You can publish the exact approved version now.</span></div> : null}
              {selected.status === "scheduled" ? <div className="cs-pc-guidance"><strong>{selected.scheduledReplacement ? "Scheduled replacement is preserving the current live Page." : "This release is already scheduled."}</strong><span>{selected.scheduledReplacement ? "The candidate’s future timestamp is shown in this command centre while the public resolver continues serving the existing published version until atomic handover." : "The command centre is monitoring it on the timeline. Reschedule/cancel controls remain disabled until their lifecycle is separately governed."}</span></div> : null}
            </>
          )}
        </section>
      </div>

      <Timeline days={timeline} collisions={summary.collisionMap} />

      <section className="cs-pc-overdue">
        <header><div><span>REVIEW AGING</span><strong>Items waiting on human review</strong></div><small>24h warning · 72h critical</small></header>
        <div className="cs-pc-overdue-list">
          {normalizedApprovals.filter((approval) => approval.overdue).sort((a, b) => b.ageHours - a.ageHours).slice(0, 12).map((approval) => (
            <article key={`${approval.approval_source}-${approval.id}`} className={approval.severelyOverdue ? "is-critical" : ""}>
              <span>{approval.severelyOverdue ? "72H+" : "24H+"}</span>
              <div><strong>{approval.title || approval.name || approval.label || approval.entity_type || `Approval #${approval.id}`}</strong><small>{statusLabel(approval.approval_source)} · requested {displayDate(approval.requestedAt)}</small></div>
              <b>{Math.floor(approval.ageHours)}h</b>
            </article>
          ))}
          {!normalizedApprovals.some((approval) => approval.overdue) ? <div className="cs-pc-empty"><strong>No review requests are older than 24 hours.</strong><span>The approval queue is within the command centre’s aging threshold.</span></div> : null}
        </div>
        <button type="button" className="cs-pc-open-approvals" onClick={() => onOpenSection?.("approvals")}>Open Approval Inbox →</button>
      </section>
    </div>
  );
}
