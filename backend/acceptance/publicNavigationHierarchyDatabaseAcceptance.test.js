"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { pool } = require("../config/db");
const {
  createNavigationDraft,
  decideNavigationApproval,
  publishNavigationVersion,
  submitNavigationVersion,
} = require("../services/contentStudioNavigationService");
const {
  listNavigationApprovals,
} = require("../services/contentStudioNavigationApprovalService");
const {
  getPublicBootstrap,
} = require("../services/publicContentService");

const author = Object.freeze({ id: 1, full_name: "Acceptance Author" });
const reviewer = Object.freeze({ id: 2, full_name: "Acceptance Reviewer" });
const publisher = Object.freeze({ id: 3, full_name: "Acceptance Publisher" });
const request = Object.freeze({
  requestId: "chalin-one-navigation-hierarchy-acceptance",
  headers: {},
});

async function publishNavigationChild({
  parentId,
  key,
  label,
  url,
  sortOrder,
  opensNewTab,
}) {
  const items = await createNavigationDraft({
    input: {
      navigation_key: key,
      parent_id: parentId,
      navigation_location: "header",
      label,
      url,
      sort_order: sortOrder,
      opens_new_tab: opensNewTab,
      change_summary: `Create ${label} navigation child`,
    },
    user: author,
    req: request,
  });
  const item = items.find((candidate) => candidate.navigation_key === key);
  assert.ok(item?.id, `${label} must return a navigation item ID.`);
  assert.ok(item?.latest_version_id, `${label} must return its exact draft version.`);

  await submitNavigationVersion({
    itemId: item.id,
    versionId: item.latest_version_id,
    assignedTo: reviewer.id,
    note: `Review the exact ${label} navigation version.`,
    user: author,
    req: request,
  });

  const approvals = await listNavigationApprovals({
    assignedTo: reviewer.id,
    limit: 50,
    offset: 0,
  });
  const approval = approvals.items.find(
    (candidate) =>
      Number(candidate.entity_id) === Number(item.id) &&
      Number(candidate.content_version_id) === Number(item.latest_version_id) &&
      candidate.approval_status === "pending"
  );
  assert.ok(approval?.id, `${label} must have an exact-version approval.`);

  await decideNavigationApproval({
    approvalId: approval.id,
    decision: "approved",
    note: `${label} hierarchy approved independently.`,
    user: reviewer,
    req: request,
  });
  await publishNavigationVersion({
    itemId: item.id,
    versionId: item.latest_version_id,
    user: publisher,
    req: request,
  });

  return item;
}

function collectPrivateFields(value, trail = [], findings = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectPrivateFields(item, [...trail, String(index)], findings)
    );
    return findings;
  }
  if (!value || typeof value !== "object") return findings;

  const privateKeys = new Set([
    "id",
    "parent_id",
    "page_id",
    "entity_id",
    "content_version_id",
    "snapshot_json",
    "created_by",
    "updated_by",
    "published_by",
  ]);
  for (const [key, item] of Object.entries(value)) {
    if (privateKeys.has(String(key).toLowerCase())) {
      findings.push([...trail, key].join("."));
    }
    collectPrivateFields(item, [...trail, key], findings);
  }
  return findings;
}

test(
  "published child navigation preserves safe hierarchy and new-tab intent",
  { timeout: 120000 },
  async () => {
    const [[databaseRow]] = await pool.query("SELECT DATABASE() AS database_name");
    assert.match(
      String(databaseRow?.database_name || ""),
      /^chalin_one_acceptance(?:_[a-z0-9_]+)?$/i
    );

    const [[parentRow]] = await pool.query(
      `SELECT id
         FROM public_navigation_items
        WHERE navigation_key = 'acceptance_home'
          AND publication_status = 'published'
        LIMIT 1`
    );
    const parentId = Number(parentRow?.id);
    assert.ok(
      parentId,
      "The core serial acceptance must publish the parent navigation item first."
    );

    await publishNavigationChild({
      parentId,
      key: "acceptance_projects_child",
      label: "Projects",
      url: "/projects",
      sortOrder: 1,
      opensNewTab: false,
    });
    await publishNavigationChild({
      parentId,
      key: "acceptance_external_child",
      label: "Verified external information",
      url: "https://preview.example-chalin03.com/verified-information",
      sortOrder: 2,
      opensNewTab: true,
    });

    const bootstrap = await getPublicBootstrap();
    const parent = bootstrap.navigation.find(
      (item) => item.key === "acceptance_home"
    );
    const projects = bootstrap.navigation.find(
      (item) => item.key === "acceptance_projects_child"
    );
    const external = bootstrap.navigation.find(
      (item) => item.key === "acceptance_external_child"
    );

    assert.equal(parent?.parent_key, null);
    assert.equal(projects?.parent_key, "acceptance_home");
    assert.equal(projects?.location, "header");
    assert.equal(projects?.url, "/projects");
    assert.equal(projects?.opens_new_tab, false);
    assert.equal(external?.parent_key, "acceptance_home");
    assert.equal(
      external?.url,
      "https://preview.example-chalin03.com/verified-information"
    );
    assert.equal(external?.opens_new_tab, true);

    const parentIndex = bootstrap.navigation.findIndex(
      (item) => item.key === "acceptance_home"
    );
    const projectsIndex = bootstrap.navigation.findIndex(
      (item) => item.key === "acceptance_projects_child"
    );
    const externalIndex = bootstrap.navigation.findIndex(
      (item) => item.key === "acceptance_external_child"
    );
    assert.ok(parentIndex >= 0 && projectsIndex > parentIndex);
    assert.ok(externalIndex > projectsIndex);
    assert.deepEqual(collectPrivateFields(bootstrap.navigation), []);

    const [auditRows] = await pool.query(
      `SELECT entity_type, action_key, actor_user_id
         FROM public_content_audit_log
        WHERE request_id = ?
          AND action_key = 'navigation_item_published'
        ORDER BY id`,
      [request.requestId]
    );
    assert.equal(auditRows.length, 2);
    assert.equal(
      auditRows.every(
        (row) =>
          row.entity_type === "navigation_item" &&
          Number(row.actor_user_id) === publisher.id
      ),
      true
    );
  }
);

test.after(async () => {
  await pool.end();
});
