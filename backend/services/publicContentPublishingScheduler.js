"use strict";

const { pool } = require("../config/db");
const { isFeatureEnabled } = require("./featureFlagService");

const SCHEDULER_LOCK_NAME = "chalin03:public-content:scheduler";
const DEFAULT_INTERVAL_MS = 60000;
const MIN_INTERVAL_MS = 60000;
const MAX_BATCH_SIZE = 100;

const SIMPLE_PUBLISHABLE_TABLES = Object.freeze([
  Object.freeze({
    table: "public_navigation_items",
    entityType: "navigation_item",
    hasPublishedAt: false,
  }),
  Object.freeze({
    table: "public_news_articles",
    entityType: "news_article",
    hasPublishedAt: true,
  }),
  Object.freeze({
    table: "public_announcements",
    entityType: "announcement",
    hasPublishedAt: true,
  }),
  Object.freeze({
    table: "public_business_divisions",
    entityType: "business_division",
    hasPublishedAt: true,
  }),
  Object.freeze({
    table: "public_leadership_profiles",
    entityType: "leadership_profile",
    hasPublishedAt: true,
  }),
  Object.freeze({
    table: "public_projects",
    entityType: "project",
    hasPublishedAt: true,
  }),
  Object.freeze({
    table: "public_equipment_catalogue",
    entityType: "equipment",
    hasPublishedAt: true,
  }),
  Object.freeze({
    table: "public_testimonials",
    entityType: "testimonial",
    hasPublishedAt: true,
  }),
  Object.freeze({
    table: "public_locations",
    entityType: "location",
    hasPublishedAt: true,
  }),
  Object.freeze({
    table: "public_company_statistics",
    entityType: "company_statistic",
    hasPublishedAt: true,
  }),
  Object.freeze({
    table: "public_job_vacancies",
    entityType: "job_vacancy",
    hasPublishedAt: true,
  }),
  Object.freeze({
    table: "public_tenders",
    entityType: "tender",
    hasPublishedAt: true,
  }),
  Object.freeze({
    table: "public_faqs",
    entityType: "faq",
    hasPublishedAt: true,
  }),
  Object.freeze({
    table: "public_forms",
    entityType: "public_form",
    hasPublishedAt: true,
  }),
]);

let schedulerTimer = null;
let initialTimer = null;

function schedulerEnabled(env = process.env) {
  return (
    isFeatureEnabled("publicWebsite", env) ||
    isFeatureEnabled("contentStudio", env)
  );
}

function schedulerIntervalMs(env = process.env) {
  const configured = Number(env.PUBLIC_CONTENT_SCHEDULER_INTERVAL_MS);
  if (!Number.isFinite(configured) || configured < MIN_INTERVAL_MS) {
    return DEFAULT_INTERVAL_MS;
  }

  return Math.floor(configured);
}

function assertSafeIdentifier(value) {
  const identifier = String(value || "").trim();
  if (!/^[a-z][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Unsafe scheduler SQL identifier: ${identifier}`);
  }
  return identifier;
}

async function insertSchedulerAudit(
  connection,
  { entityType, entityId, actionKey, before, after, metadata = null }
) {
  await connection.query(
    `INSERT INTO public_content_audit_log (
       entity_type,
       entity_id,
       action_key,
       before_json,
       after_json,
       metadata_json
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      entityType,
      entityId,
      actionKey,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );
}

async function acquireLock(connection) {
  const [[row]] = await connection.query(
    "SELECT GET_LOCK(?, 0) AS acquired",
    [SCHEDULER_LOCK_NAME]
  );
  return Number(row?.acquired) === 1;
}

async function releaseLock(connection) {
  try {
    await connection.query("SELECT RELEASE_LOCK(?)", [SCHEDULER_LOCK_NAME]);
  } catch {
    // Advisory locks are also released when the connection closes.
  }
}

async function publishDuePages(connection) {
  const [rows] = await connection.query(
    `SELECT
       p.id AS page_id,
       p.publication_status AS page_status,
       v.id AS version_id,
       v.version_number,
       v.version_status
     FROM public_pages p
     JOIN public_page_versions v
       ON v.page_id = p.id
      AND v.version_status = 'scheduled'
      AND v.publish_at IS NOT NULL
      AND v.publish_at <= UTC_TIMESTAMP()
     WHERE p.publication_status = 'scheduled'
     ORDER BY v.publish_at, v.id
     LIMIT ${MAX_BATCH_SIZE}
     FOR UPDATE`
  );

  for (const row of rows) {
    await connection.query(
      `UPDATE public_page_versions
       SET version_status = 'superseded'
       WHERE page_id = ?
         AND id <> ?
         AND version_status = 'published'`,
      [row.page_id, row.version_id]
    );
    await connection.query(
      `UPDATE public_page_versions
       SET version_status = 'published',
           published_at = COALESCE(published_at, UTC_TIMESTAMP())
       WHERE id = ?`,
      [row.version_id]
    );
    await connection.query(
      `UPDATE public_pages
       SET publication_status = 'published',
           published_at = COALESCE(published_at, UTC_TIMESTAMP()),
           updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [row.page_id]
    );
    await insertSchedulerAudit(connection, {
      entityType: "page",
      entityId: row.page_id,
      actionKey: "scheduled_page_published",
      before: {
        page_status: row.page_status,
        version_status: row.version_status,
      },
      after: {
        page_status: "published",
        version_status: "published",
        version_id: row.version_id,
        version_number: row.version_number,
      },
      metadata: { source: "public_content_scheduler" },
    });
  }

  return rows.length;
}

async function expireDuePages(connection) {
  const [rows] = await connection.query(
    `SELECT id, publication_status
     FROM public_pages
     WHERE publication_status IN ('published', 'scheduled')
       AND expires_at IS NOT NULL
       AND expires_at <= UTC_TIMESTAMP()
     ORDER BY expires_at, id
     LIMIT ${MAX_BATCH_SIZE}
     FOR UPDATE`
  );

  for (const row of rows) {
    await connection.query(
      `UPDATE public_pages
       SET publication_status = 'expired',
           updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [row.id]
    );
    await connection.query(
      `UPDATE public_page_versions
       SET version_status = 'archived'
       WHERE page_id = ?
         AND version_status IN ('published', 'scheduled')`,
      [row.id]
    );
    await insertSchedulerAudit(connection, {
      entityType: "page",
      entityId: row.id,
      actionKey: "page_expired",
      before: { publication_status: row.publication_status },
      after: { publication_status: "expired" },
      metadata: { source: "public_content_scheduler" },
    });
  }

  return rows.length;
}

async function publishDueSimpleRecords(connection, definition) {
  const table = assertSafeIdentifier(definition.table);
  const [rows] = await connection.query(
    `SELECT id, publication_status
     FROM \`${table}\`
     WHERE publication_status = 'scheduled'
       AND publish_at IS NOT NULL
       AND publish_at <= UTC_TIMESTAMP()
     ORDER BY publish_at, id
     LIMIT ${MAX_BATCH_SIZE}
     FOR UPDATE`
  );

  for (const row of rows) {
    const publishedAtClause = definition.hasPublishedAt
      ? ", published_at = COALESCE(published_at, UTC_TIMESTAMP())"
      : "";
    await connection.query(
      `UPDATE \`${table}\`
       SET publication_status = 'published'${publishedAtClause},
           updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [row.id]
    );
    await insertSchedulerAudit(connection, {
      entityType: definition.entityType,
      entityId: row.id,
      actionKey: "scheduled_content_published",
      before: { publication_status: row.publication_status },
      after: { publication_status: "published" },
      metadata: {
        source: "public_content_scheduler",
        table,
      },
    });
  }

  return rows.length;
}

async function expireDueSimpleRecords(connection, definition) {
  const table = assertSafeIdentifier(definition.table);
  const [rows] = await connection.query(
    `SELECT id, publication_status
     FROM \`${table}\`
     WHERE publication_status IN ('published', 'scheduled')
       AND expires_at IS NOT NULL
       AND expires_at <= UTC_TIMESTAMP()
     ORDER BY expires_at, id
     LIMIT ${MAX_BATCH_SIZE}
     FOR UPDATE`
  );

  for (const row of rows) {
    await connection.query(
      `UPDATE \`${table}\`
       SET publication_status = 'expired',
           updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [row.id]
    );
    await insertSchedulerAudit(connection, {
      entityType: definition.entityType,
      entityId: row.id,
      actionKey: "content_expired",
      before: { publication_status: row.publication_status },
      after: { publication_status: "expired" },
      metadata: {
        source: "public_content_scheduler",
        table,
      },
    });
  }

  return rows.length;
}

async function runPublicContentPublishingCycle({ env = process.env } = {}) {
  if (!schedulerEnabled(env)) {
    return {
      skipped: true,
      reason: "feature_disabled",
      pages_published: 0,
      pages_expired: 0,
      records_published: 0,
      records_expired: 0,
    };
  }

  const connection = await pool.getConnection();

  try {
    if (!(await acquireLock(connection))) {
      return {
        skipped: true,
        reason: "lock_unavailable",
        pages_published: 0,
        pages_expired: 0,
        records_published: 0,
        records_expired: 0,
      };
    }

    await connection.beginTransaction();
    const pagesPublished = await publishDuePages(connection);
    const pagesExpired = await expireDuePages(connection);
    let recordsPublished = 0;
    let recordsExpired = 0;

    for (const definition of SIMPLE_PUBLISHABLE_TABLES) {
      recordsPublished += await publishDueSimpleRecords(
        connection,
        definition
      );
      recordsExpired += await expireDueSimpleRecords(
        connection,
        definition
      );
    }

    await connection.commit();

    return {
      skipped: false,
      pages_published: pagesPublished,
      pages_expired: pagesExpired,
      records_published: recordsPublished,
      records_expired: recordsExpired,
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original failure.
    }

    if (error?.code === "ER_NO_SUCH_TABLE") {
      return {
        skipped: true,
        reason: "schema_not_ready",
        pages_published: 0,
        pages_expired: 0,
        records_published: 0,
        records_expired: 0,
      };
    }

    throw error;
  } finally {
    await releaseLock(connection);
    connection.release();
  }
}

function stopPublicContentScheduler() {
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = null;
  }
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

function startPublicContentScheduler({ env = process.env } = {}) {
  stopPublicContentScheduler();

  if (!schedulerEnabled(env)) {
    return {
      started: false,
      reason: "feature_disabled",
    };
  }

  const intervalMs = schedulerIntervalMs(env);
  const execute = () => {
    runPublicContentPublishingCycle({ env }).catch((error) => {
      console.error("Public content publishing cycle failed:", error.message);
    });
  };

  initialTimer = setTimeout(execute, 5000);
  initialTimer.unref?.();
  schedulerTimer = setInterval(execute, intervalMs);
  schedulerTimer.unref?.();

  return {
    started: true,
    interval_ms: intervalMs,
  };
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  MAX_BATCH_SIZE,
  MIN_INTERVAL_MS,
  SCHEDULER_LOCK_NAME,
  SIMPLE_PUBLISHABLE_TABLES,
  assertSafeIdentifier,
  expireDuePages,
  expireDueSimpleRecords,
  publishDuePages,
  publishDueSimpleRecords,
  runPublicContentPublishingCycle,
  schedulerEnabled,
  schedulerIntervalMs,
  startPublicContentScheduler,
  stopPublicContentScheduler,
};
