"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { pool } = require("../config/db");
const {
  createPageDraft,
  createPageVersion,
  decidePageApproval,
  getPageDetails,
  submitPageVersion,
} = require("../services/contentStudioPageService");
const {
  publishPageVersion,
} = require("../services/contentStudioPagePublishWorkflow");
const {
  getPublicPageBySlug,
} = require("../services/publicContentService");

const PAGE_KEY = "phase_2k_studio_completion";
const PAGE_SLUG = "phase-2k-studio-completion";
const AUTHOR = Object.freeze({ id: 1, full_name: "Acceptance Author" });
const REVIEWER = Object.freeze({ id: 2, full_name: "Acceptance Reviewer" });
const PUBLISHER = Object.freeze({ id: 3, full_name: "Acceptance Publisher" });

function requestFor(user, requestId) {
  return {
    user,
    requestId,
    headers: {},
    ip: "127.0.0.1",
  };
}

function newestVersion(details) {
  return [...(details?.versions || [])].sort(
    (left, right) => Number(right.version_number) - Number(left.version_number)
  )[0];
}

function newestApproval(details) {
  return [...(details?.approvals || [])].sort(
    (left, right) => Number(right.id) - Number(left.id)
  )[0];
}

async function removePriorFixture() {
  const [rows] = await pool.query(
    `SELECT id
       FROM public_pages
      WHERE page_key = ? OR slug = ?`,
    [PAGE_KEY, PAGE_SLUG]
  );

  for (const row of rows) {
    const pageId = Number(row.id);
    await pool.query(
      "DELETE FROM public_content_audit_log WHERE entity_type = 'page' AND entity_id = ?",
      [pageId]
    );
    await pool.query(
      "DELETE FROM public_content_approvals WHERE entity_type = 'page' AND entity_id = ?",
      [pageId]
    );
    await pool.query(
      `DELETE FROM public_page_sections
        WHERE page_version_id IN (
          SELECT id FROM public_page_versions WHERE page_id = ?
        )`,
      [pageId]
    );
    await pool.query("DELETE FROM public_page_versions WHERE page_id = ?", [pageId]);
    await pool.query("DELETE FROM public_pages WHERE id = ?", [pageId]);
  }
}

test("Phase 2K proves Editor → Reviewer → Publisher governance and public reflection on isolated MySQL", async () => {
  await removePriorFixture();

  const created = await createPageDraft({
    input: {
      page_key: PAGE_KEY,
      slug: PAGE_SLUG,
      page_type: "standard",
      template_key: "standard",
      menu_title: "Phase 2K Acceptance",
      title: "Phase 2K Studio Final Acceptance v1",
      summary: "Governed Content Studio lifecycle acceptance fixture.",
      seo_title: "Phase 2K Studio Final Acceptance",
      meta_description:
        "A controlled acceptance page used only in isolated CHALIN ONE CI to prove governed editorial review, publishing and public reflection.",
      robots_directive: "noindex,nofollow",
      change_summary: "Create final Studio acceptance fixture",
      show_in_search: false,
      show_in_sitemap: false,
      sections: [
        {
          section_key: "phase_2k_proof",
          section_type: "text",
          heading: "Governed lifecycle proof",
          content: { text: "First governed release" },
          sort_order: 0,
          is_enabled: true,
        },
      ],
    },
    user: AUTHOR,
    req: requestFor(AUTHOR, "phase2k-create-v1"),
  });

  const pageId = Number(created.page.id);
  const firstVersion = newestVersion(created);
  assert.equal(firstVersion.version_number, 1);
  assert.equal(firstVersion.version_status, "draft");
  assert.equal(await getPublicPageBySlug(PAGE_SLUG), null);

  await assert.rejects(
    () =>
      publishPageVersion({
        pageId,
        versionId: firstVersion.id,
        user: PUBLISHER,
        req: requestFor(PUBLISHER, "phase2k-block-unapproved-v1"),
      }),
    (error) => error?.code === "PAGE_VERSION_NOT_APPROVED"
  );

  const submittedV1 = await submitPageVersion({
    pageId,
    versionId: firstVersion.id,
    assignedTo: REVIEWER.id,
    note: "Independent Phase 2K review required.",
    user: AUTHOR,
    req: requestFor(AUTHOR, "phase2k-submit-v1"),
  });
  const firstApproval = newestApproval(submittedV1);
  assert.equal(newestVersion(submittedV1).version_status, "in_review");
  assert.equal(firstApproval.approval_status, "pending");
  assert.equal(await getPublicPageBySlug(PAGE_SLUG), null);

  await assert.rejects(
    () =>
      decidePageApproval({
        approvalId: firstApproval.id,
        decision: "approved",
        note: "Self approval must fail.",
        user: AUTHOR,
        req: requestFor(AUTHOR, "phase2k-self-approval-block"),
      }),
    (error) => error?.code === "CONTENT_SELF_APPROVAL_BLOCKED"
  );

  await assert.rejects(
    () =>
      decidePageApproval({
        approvalId: firstApproval.id,
        decision: "approved",
        note: "Wrong assignee must fail.",
        user: PUBLISHER,
        req: requestFor(PUBLISHER, "phase2k-wrong-reviewer-block"),
      }),
    (error) => error?.code === "CONTENT_APPROVAL_ASSIGNED_ELSEWHERE"
  );

  const approvedV1 = await decidePageApproval({
    approvalId: firstApproval.id,
    decision: "approved",
    note: "Independent review approved.",
    user: REVIEWER,
    req: requestFor(REVIEWER, "phase2k-approve-v1"),
  });
  assert.equal(newestVersion(approvedV1).version_status, "approved");
  assert.equal(await getPublicPageBySlug(PAGE_SLUG), null);

  await publishPageVersion({
    pageId,
    versionId: firstVersion.id,
    user: PUBLISHER,
    req: requestFor(PUBLISHER, "phase2k-publish-v1"),
  });

  const publicV1 = await getPublicPageBySlug(PAGE_SLUG);
  assert.equal(publicV1.title, "Phase 2K Studio Final Acceptance v1");
  assert.equal(publicV1.version, 1);
  assert.equal(publicV1.sections[0]?.key, "phase_2k_proof");
  assert.equal(publicV1.sections[0]?.content?.text, "First governed release");

  const draftV2 = await createPageVersion({
    pageId,
    input: {
      title: "Phase 2K Studio Final Acceptance v2",
      change_summary: "Prove draft and approval states never replace live content",
      sections: [
        {
          section_key: "phase_2k_proof",
          section_type: "text",
          heading: "Governed lifecycle proof",
          content: { text: "Second governed release" },
          sort_order: 0,
          is_enabled: true,
        },
      ],
    },
    user: AUTHOR,
    req: requestFor(AUTHOR, "phase2k-create-v2"),
  });
  const secondVersion = newestVersion(draftV2);
  assert.equal(secondVersion.version_number, 2);
  assert.equal(secondVersion.version_status, "draft");
  assert.equal((await getPublicPageBySlug(PAGE_SLUG)).version, 1);

  const submittedV2 = await submitPageVersion({
    pageId,
    versionId: secondVersion.id,
    assignedTo: REVIEWER.id,
    note: "Review the replacement while v1 remains public.",
    user: AUTHOR,
    req: requestFor(AUTHOR, "phase2k-submit-v2"),
  });
  const secondApproval = newestApproval(submittedV2);
  assert.equal((await getPublicPageBySlug(PAGE_SLUG)).version, 1);

  await decidePageApproval({
    approvalId: secondApproval.id,
    decision: "approved",
    note: "Replacement independently approved.",
    user: REVIEWER,
    req: requestFor(REVIEWER, "phase2k-approve-v2"),
  });
  assert.equal((await getPublicPageBySlug(PAGE_SLUG)).version, 1);

  await publishPageVersion({
    pageId,
    versionId: secondVersion.id,
    user: PUBLISHER,
    req: requestFor(PUBLISHER, "phase2k-publish-v2"),
  });

  const publicV2 = await getPublicPageBySlug(PAGE_SLUG);
  assert.equal(publicV2.title, "Phase 2K Studio Final Acceptance v2");
  assert.equal(publicV2.version, 2);
  assert.equal(publicV2.sections[0]?.content?.text, "Second governed release");

  const finalDetails = await getPageDetails(pageId);
  const versionsByNumber = new Map(
    finalDetails.versions.map((version) => [Number(version.version_number), version])
  );
  assert.equal(versionsByNumber.get(1)?.version_status, "superseded");
  assert.equal(versionsByNumber.get(2)?.version_status, "published");
  assert.equal(Number(versionsByNumber.get(2)?.published_by), PUBLISHER.id);

  const [approvalRows] = await pool.query(
    `SELECT requested_by, assigned_to, approval_status, decided_by, decided_at, executed_at
       FROM public_content_approvals
      WHERE entity_type = 'page'
        AND entity_id = ?
      ORDER BY id`,
    [pageId]
  );
  assert.equal(approvalRows.length, 2);
  for (const approval of approvalRows) {
    assert.equal(Number(approval.requested_by), AUTHOR.id);
    assert.equal(Number(approval.assigned_to), REVIEWER.id);
    assert.equal(approval.approval_status, "approved");
    assert.equal(Number(approval.decided_by), REVIEWER.id);
    assert.ok(approval.decided_at);
    assert.ok(approval.executed_at);
  }

  const [auditRows] = await pool.query(
    `SELECT action_key, actor_user_id
       FROM public_content_audit_log
      WHERE entity_type = 'page'
        AND entity_id = ?
      ORDER BY id`,
    [pageId]
  );
  const actionCounts = auditRows.reduce((counts, row) => {
    counts[row.action_key] = Number(counts[row.action_key] || 0) + 1;
    return counts;
  }, {});
  assert.equal(actionCounts.page_created, 1);
  assert.equal(actionCounts.page_review_requested, 2);
  assert.equal(actionCounts.page_review_approved, 2);
  assert.equal(actionCounts.page_published, 2);
  assert.ok(auditRows.some((row) => row.action_key === "page_created" && Number(row.actor_user_id) === AUTHOR.id));
  assert.ok(auditRows.some((row) => row.action_key === "page_review_approved" && Number(row.actor_user_id) === REVIEWER.id));
  assert.ok(auditRows.some((row) => row.action_key === "page_published" && Number(row.actor_user_id) === PUBLISHER.id));
});

test.after(async () => {
  await pool.end();
});
