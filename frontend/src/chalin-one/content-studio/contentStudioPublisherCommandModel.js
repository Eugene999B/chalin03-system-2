export const PUBLISHER_RELEASE_SOURCES = Object.freeze([
  Object.freeze({ key: "page", kind: "page", label: "Pages", manager: "pages", badge: "PG" }),
  Object.freeze({ key: "article", kind: "article", label: "Articles", manager: "newsroom", badge: "NW" }),
  Object.freeze({ key: "announcement", kind: "announcement", label: "Announcements", manager: "newsroom", badge: "AN" }),
  Object.freeze({ key: "leadership", kind: "leadership", label: "Leadership", manager: "leadership", badge: "LD" }),
  Object.freeze({ key: "project", kind: "project", label: "Projects", manager: "projects", badge: "PJ" }),
  Object.freeze({ key: "equipment", kind: "equipment", label: "Equipment", manager: "equipment", badge: "EQ" }),
]);

const RELEASE_STATUSES = new Set([
  "draft",
  "in_review",
  "approved",
  "scheduled",
  "published",
  "expired",
  "archived",
]);

function clean(value) {
  return String(value ?? "").trim();
}

function validDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safeStatus(value) {
  const status = clean(value).toLowerCase();
  return RELEASE_STATUSES.has(status) ? status : "draft";
}

function sourceDefinition(source) {
  return PUBLISHER_RELEASE_SOURCES.find((item) => item.key === source) || null;
}

function titleFor(source, record = {}) {
  if (source === "page") {
    return clean(record.latest_title || record.menu_title || record.page_key || record.slug) || `Page #${record.id}`;
  }
  if (source === "leadership") {
    return clean(record.full_name || record.name || record.title) || `Leadership #${record.id}`;
  }
  return clean(record.title || record.name || record.label || record.slug) || `${source} #${record.id}`;
}

export function normalizePublisherRelease(source, record = {}) {
  const definition = sourceDefinition(source);
  if (!definition) return null;
  const id = Number(record.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  return {
    key: `${source}:${id}`,
    source,
    kind: definition.kind,
    label: definition.label,
    badge: definition.badge,
    manager: definition.manager,
    id,
    title: titleFor(source, record),
    subtitle: clean(record.slug ? `/${record.slug}` : record.role_title || record.model || record.reference_code || ""),
    status: safeStatus(record.publication_status),
    publishAt: validDate(record.publish_at),
    expiresAt: validDate(record.expires_at),
    publishedAt: validDate(record.published_at),
    updatedAt: validDate(record.updated_at),
    latestVersionId: Number(record.latest_version_id) || null,
    latestVersionNumber: Number(record.latest_version_number) || null,
    latestVersionStatus: clean(record.latest_version_status).toLowerCase() || null,
    raw: record,
  };
}

export function normalizePublisherApprovals(items = [], now = new Date()) {
  const reference = validDate(now) || new Date();
  return (Array.isArray(items) ? items : []).map((item) => {
    const requestedAt = validDate(item?.requested_at);
    const ageHours = requestedAt
      ? Math.max(0, (reference.getTime() - requestedAt.getTime()) / 3600000)
      : 0;
    return {
      ...item,
      requestedAt,
      ageHours,
      overdue: Boolean(requestedAt) && ageHours >= 24,
      severelyOverdue: Boolean(requestedAt) && ageHours >= 72,
    };
  });
}

export function selectApprovedReleaseVersion(details = {}) {
  const versions = Array.isArray(details?.versions) ? details.versions : [];
  return versions.find((version) => clean(version?.version_status).toLowerCase() === "approved") || null;
}

export function releaseSchedulePayload(publishLocalValue, expiresLocalValue = "", now = new Date()) {
  const publishAt = validDate(publishLocalValue);
  if (!publishAt) {
    return { valid: false, error: "Choose a valid publication date and time." };
  }
  const reference = validDate(now) || new Date();
  if (publishAt.getTime() <= reference.getTime()) {
    return { valid: false, error: "Scheduled publication must be in the future." };
  }
  const expiresAt = expiresLocalValue ? validDate(expiresLocalValue) : null;
  if (expiresLocalValue && !expiresAt) {
    return { valid: false, error: "Choose a valid expiry date and time." };
  }
  if (expiresAt && expiresAt.getTime() <= publishAt.getTime()) {
    return { valid: false, error: "Expiry must be later than publication." };
  }
  return {
    valid: true,
    payload: {
      publish_at: publishAt.toISOString(),
      expires_at: expiresAt ? expiresAt.toISOString() : null,
    },
  };
}

export function publisherCollisionMap(items = [], collisionMinutes = 60) {
  const threshold = Math.max(1, Number(collisionMinutes) || 60) * 60000;
  const scheduled = (Array.isArray(items) ? items : [])
    .filter((item) => item?.status === "scheduled" && item.publishAt)
    .sort((left, right) => left.publishAt.getTime() - right.publishAt.getTime());
  const collisions = new Map();
  for (let index = 0; index < scheduled.length; index += 1) {
    for (let cursor = index + 1; cursor < scheduled.length; cursor += 1) {
      const delta = scheduled[cursor].publishAt.getTime() - scheduled[index].publishAt.getTime();
      if (delta > threshold) break;
      if (!collisions.has(scheduled[index].key)) collisions.set(scheduled[index].key, []);
      if (!collisions.has(scheduled[cursor].key)) collisions.set(scheduled[cursor].key, []);
      collisions.get(scheduled[index].key).push(scheduled[cursor].key);
      collisions.get(scheduled[cursor].key).push(scheduled[index].key);
    }
  }
  return collisions;
}

export function publisherCommandSummary(items = [], approvals = [], now = new Date()) {
  const reference = validDate(now) || new Date();
  const collisionMap = publisherCollisionMap(items);
  const nextSevenDays = reference.getTime() + 7 * 86400000;
  const scheduled = items.filter((item) => item.status === "scheduled");
  const approved = items.filter((item) => item.status === "approved" || item.latestVersionStatus === "approved");
  const expiringSoon = items.filter((item) =>
    item.expiresAt &&
    item.expiresAt.getTime() >= reference.getTime() &&
    item.expiresAt.getTime() <= nextSevenDays
  );
  const dueOrLate = scheduled.filter((item) => item.publishAt && item.publishAt.getTime() <= reference.getTime());
  const normalizedApprovals = normalizePublisherApprovals(approvals, reference);
  return {
    scheduled: scheduled.length,
    approved: approved.length,
    collisions: collisionMap.size,
    expiringSoon: expiringSoon.length,
    dueOrLate: dueOrLate.length,
    overdueReviews: normalizedApprovals.filter((item) => item.overdue).length,
    severelyOverdueReviews: normalizedApprovals.filter((item) => item.severelyOverdue).length,
    collisionMap,
    normalizedApprovals,
  };
}

function localDayKey(date) {
  const value = validDate(date);
  if (!value) return "unknown";
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildPublisherTimeline(items = [], now = new Date(), horizonDays = 21) {
  const reference = validDate(now) || new Date();
  const end = reference.getTime() + Math.max(1, Number(horizonDays) || 21) * 86400000;
  const events = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (item.publishAt && item.publishAt.getTime() >= reference.getTime() - 86400000 && item.publishAt.getTime() <= end) {
      events.push({ type: "publish", at: item.publishAt, dayKey: localDayKey(item.publishAt), item });
    }
    if (item.expiresAt && item.expiresAt.getTime() >= reference.getTime() - 86400000 && item.expiresAt.getTime() <= end) {
      events.push({ type: "expire", at: item.expiresAt, dayKey: localDayKey(item.expiresAt), item });
    }
  }
  events.sort((left, right) => left.at.getTime() - right.at.getTime());
  const days = new Map();
  for (const event of events) {
    if (!days.has(event.dayKey)) days.set(event.dayKey, []);
    days.get(event.dayKey).push(event);
  }
  return [...days.entries()].map(([dayKey, dayEvents]) => ({ dayKey, events: dayEvents }));
}
