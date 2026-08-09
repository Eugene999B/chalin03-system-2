"use strict";

const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");
const {
  ContentStudioError,
  getPageDetails,
  insertContentAudit,
  normalizeDateTime,
  positiveInteger,
  schemaNotReadyError,
  validatePublishingWindow,
} = require("./contentStudioPageService");

function pagePublishPlan({ scheduled = false, hasPublishedVersion = false } = {}) {
  if (!scheduled) {
    return Object.freeze({
      targetVersionStatus: "published",
      targetPageStatus: "published",
      preservePageWindow: false,
      supersedePublished: true,
      supersedeScheduled: true,
      executeApprovalNow: true,
    });
  }
  if (hasPublishedVersion) {
    return Object.freeze({
      targetVersionStatus: "scheduled",
      targetPageStatus: "published",
      preservePageWindow: true,
      supersedePublished: false,
      supersedeScheduled: true,
      executeApprovalNow: false,
    });
  }
  return Object.freeze({
    targetVersionStatus: "scheduled",
    targetPageStatus: "scheduled",
    preservePageWindow: false,
    supersedePublished: false,
    supersedeScheduled: true,
    executeApprovalNow: false,
  });
}

async function loadPageForUpdate(connection, pageId) {
  const [rows] = await connection.query(
    "SELECT * FROM public_pages WHERE id = ? LIMIT 1 FOR UPDATE",
    [pageId]
  );
  if (!rows[0]) {
    throw new ContentStudioError("Page not found.", {
      code: "CONTENT_PAGE_NOT_FOUND",
      statusCode: 404,
    });
  }
  return rows[0];
}

async function loadVersionForUpdate(connection, pageId, versionId) {
  const [rows] = await connection.query(
    `SELECT * FROM public_page_versions
     WHERE id = ? AND page_id = ?
     LIMIT 1 FOR UPDATE`,
    [versionId, pageId]
  );
  if (!rows[0]) {
    throw new ContentStudioError("Page version not found.", {
      code: "CONTENT_PAGE_VERSION_NOT_FOUND",
      statusCode: 404,
    });
  }
  return rows[0];
}

async function loadPublishedVersionForUpdate(connection, pageId, excludingVersionId) {
  const [rows] = await connection.query(
    `SELECT id, version_number, publish_at, expires_at, published_at
     FROM public_page_versions
     WHERE page_id = ?
       AND id <> ?
       AND version_status = 'published'
     ORDER BY version_number DESC, id DESC
     LIMIT 1 FOR UPDATE`,
    [pageId, excludingVersionId]
  );
  return rows[0] || null;
}

async function loadApprovedReviewForUpdate(connection, pageId, versionId) {
  const [rows] = await connection.query(
    `SELECT *
     FROM public_content_approvals
     WHERE entity_type = 'page'
       AND entity_id = ?
       AND page_version_id = ?
       AND approval_status = 'approved'
     ORDER BY decided_at DESC, id DESC
     LIMIT 1 FOR UPDATE`,
    [pageId, versionId]
  );
  return rows[0] || null;
}

async function writePlatformAudit(connection, req, action, pageId, metadata) {
  await writeAuditEvent({
    connection,
    req,
    action,
    details: `CHALIN ONE Content Studio ${action}`,
    entityType: "public_page",
    entityId: pageId,
    actionType: action,
    metadata,
  });
}

async function publishPageVersion({
  pageId,
  versionId,
  publishAt,
  expiresAt,
  user,
  req,
}) {
  const id = positiveInteger(pageId);
  const versionRecordId = positiveInteger(versionId);
  if (!id || !versionRecordId) {
    throw new ContentStudioError("Invalid page or version ID.", {
      code: "INVALID_PAGE_VERSION_ID",
      statusCode: 400,
    });
  }

  const scheduledAt = normalizeDateTime(publishAt);
  const expiryAt = normalizeDateTime(expiresAt);
  validatePublishingWindow(scheduledAt, expiryAt);
  const scheduled = Boolean(scheduledAt && scheduledAt.getTime() > Date.now());
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const page = await loadPageForUpdate(connection, id);
    const version = await loadVersionForUpdate(connection, id, versionRecordId);

    if (version.version_status !== "approved") {
      throw new ContentStudioError(
        "Only an approved page version may be published or scheduled.",
        {
          code: "PAGE_VERSION_NOT_APPROVED",
          statusCode: 409,
        }
      );
    }

    const approval = await loadApprovedReviewForUpdate(
      connection,
      id,
      versionRecordId
    );
    if (!approval) {
      throw new ContentStudioError(
        "Publishing requires an approved human review record.",
        {
          code: "APPROVED_REVIEW_REQUIRED",
          statusCode: 409,
        }
      );
    }

    const publishedVersion = await loadPublishedVersionForUpdate(
      connection,
      id,
      versionRecordId
    );
    const plan = pagePublishPlan({
      scheduled,
      hasPublishedVersion: Boolean(publishedVersion),
    });

    if (plan.supersedeScheduled) {
      await connection.query(
        `UPDATE public_page_versions
         SET version_status = 'superseded'
         WHERE page_id = ?
           AND id <> ?
           AND version_status = 'scheduled'`,
        [id, versionRecordId]
      );
    }
    if (plan.supersedePublished) {
      await connection.query(
        `UPDATE public_page_versions
         SET version_status = 'superseded'
         WHERE page_id = ?
           AND id <> ?
           AND version_status = 'published'`,
        [id, versionRecordId]
      );
    }

    await connection.query(
      `UPDATE public_page_versions
       SET version_status = ?,
           publish_at = ?,
           expires_at = ?,
           published_at = CASE WHEN ? = 'published' THEN UTC_TIMESTAMP() ELSE NULL END,
           published_by = ?
       WHERE id = ?`,
      [
        plan.targetVersionStatus,
        scheduledAt,
        expiryAt,
        plan.targetVersionStatus,
        user?.id || null,
        versionRecordId,
      ]
    );

    if (plan.preservePageWindow) {
      await connection.query(
        `UPDATE public_pages
         SET publication_status = 'published',
             updated_by = ?,
             updated_at = UTC_TIMESTAMP()
         WHERE id = ?`,
        [user?.id || null, id]
      );
    } else {
      await connection.query(
        `UPDATE public_pages
         SET publication_status = ?,
             publish_at = ?,
             expires_at = ?,
             published_at = CASE WHEN ? = 'published' THEN UTC_TIMESTAMP() ELSE NULL END,
             published_by = ?,
             updated_by = ?,
             updated_at = UTC_TIMESTAMP()
         WHERE id = ?`,
        [
          plan.targetPageStatus,
          scheduledAt,
          expiryAt,
          plan.targetPageStatus,
          user?.id || null,
          user?.id || null,
          id,
        ]
      );
    }

    if (plan.executeApprovalNow) {
      await connection.query(
        "UPDATE public_content_approvals SET executed_at = UTC_TIMESTAMP() WHERE id = ?",
        [approval.id]
      );
    }

    const handoverMode = scheduled
      ? publishedVersion
        ? "scheduled_replacement"
        : "scheduled_first_publication"
      : "immediate_publication";
    await insertContentAudit(connection, {
      entityType: "page",
      entityId: id,
      actionKey: scheduled ? "page_scheduled" : "page_published",
      actorUserId: user?.id,
      approvalId: approval.id,
      requestId: req?.requestId,
      before: {
        page_status: page.publication_status,
        version_status: version.version_status,
        published_version_id: publishedVersion?.id || null,
      },
      after: {
        page_status: plan.targetPageStatus,
        version_status: plan.targetVersionStatus,
        version_id: versionRecordId,
        version_number: version.version_number,
        publish_at: scheduledAt,
        expires_at: expiryAt,
        preserves_live_page: plan.preservePageWindow,
      },
      metadata: {
        handover_mode: handoverMode,
        preserved_published_version_id: plan.preservePageWindow
          ? publishedVersion?.id || null
          : null,
      },
    });
    await writePlatformAudit(
      connection,
      req,
      scheduled ? "PUBLIC_PAGE_SCHEDULED" : "PUBLIC_PAGE_PUBLISHED",
      id,
      {
        version_id: versionRecordId,
        approval_id: approval.id,
        publish_at: scheduledAt,
        expires_at: expiryAt,
        handover_mode: handoverMode,
        preserved_published_version_id: plan.preservePageWindow
          ? publishedVersion?.id || null
          : null,
      }
    );

    await connection.commit();
    return getPageDetails(id);
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

module.exports = {
  pagePublishPlan,
  publishPageVersion,
};
