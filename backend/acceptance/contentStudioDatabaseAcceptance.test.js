"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { pool } = require("../config/db");
const {
  EXPECTED_TABLES,
} = require("../scripts/runChalinOnePublicContentFoundationMigration");
const {
  createPageDraft,
  decidePageApproval,
  getContentStudioDashboard,
  publishPageVersion,
  submitPageVersion,
} = require("../services/contentStudioPageService");
const {
  createFormDraft,
  decideFormApproval,
  publishFormVersion,
  submitFormVersion,
} = require("../services/contentStudioFormService");
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
  upsertSiteSetting,
} = require("../services/contentStudioSettingsService");
const {
  getPublicBootstrap,
  getPublicFormBySlug,
  getPublicPageBySlug,
} = require("../services/publicContentService");
const {
  createPublicFormSubmission,
} = require("../services/publicFormSubmissionService");
const {
  getSubmissionDetails,
  listSubmissions,
} = require("../services/contentStudioSubmissionService");

const author = Object.freeze({ id: 1, full_name: "Acceptance Author" });
const reviewer = Object.freeze({ id: 2, full_name: "Acceptance Reviewer" });
const publisher = Object.freeze({ id: 3, full_name: "Acceptance Publisher" });
const request = Object.freeze({
  requestId: "chalin-one-database-acceptance",
  headers: {},
});
const legacyTables = Object.freeze([
  "products",
  "customers",
  "sales",
  "sale_items",
  "debts",
  "debt_payments",
  "mining_sites",
  "fleet_assets",
  "hire_contracts",
  "equipment_sale_agreements",
]);

function latestVersion(details) {
  const version = details?.versions?.[0];
  assert.ok(version?.id, "A saved version must be returned.");
  return version;
}

function pendingApproval(details, versionId, versionKey = "content_version_id") {
  const approval = details?.approvals?.find(
    (item) =>
      item.approval_status === "pending" &&
      Number(item[versionKey]) === Number(versionId)
  );
  assert.ok(approval?.id, "The exact saved version must have a pending review.");
  return approval;
}

test(
  "CHALIN ONE migration and governed publishing work against an isolated MySQL database",
  { timeout: 120000 },
  async () => {
    const [[databaseRow]] = await pool.query("SELECT DATABASE() AS database_name");
    assert.match(
      String(databaseRow?.database_name || ""),
      /^chalin_one_acceptance(?:_[a-z0-9_]+)?$/i
    );

    const [tableRows] = await pool.query(
      `SELECT TABLE_NAME AS table_name
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME LIKE 'public\\_%'`
    );
    const tableNames = new Set(tableRows.map((row) => row.table_name));
    for (const tableName of EXPECTED_TABLES) {
      assert.equal(tableNames.has(tableName), true, `${tableName} must exist`);
    }

    for (const tableName of legacyTables) {
      const [[row]] = await pool.query(
        `SELECT COUNT(*) AS row_count FROM \`${tableName}\``
      );
      assert.equal(
        Number(row?.row_count || 0),
        1,
        `${tableName} legacy rows must survive the additive migration`
      );
    }

    const pageDraft = await createPageDraft({
      input: {
        page_key: "acceptance_home",
        slug: "acceptance-home",
        page_type: "landing",
        template_key: "feature",
        menu_title: "Acceptance Home",
        title: "CHALIN ONE Acceptance Home",
        subtitle: "Database-backed publishing verification",
        summary: "This page proves the controlled publishing workflow.",
        is_homepage: true,
        show_in_search: true,
        show_in_sitemap: true,
        change_summary: "Initial acceptance draft",
        sections: [
          {
            section_key: "introduction",
            section_type: "hero",
            heading: "Built for governed public delivery",
            subheading: "Exact versions, independent review and safe publication",
            content: {
              text: "The acceptance database rendered this published section.",
            },
            settings: { alignment: "left" },
            sort_order: 0,
            is_enabled: true,
          },
        ],
      },
      user: author,
      req: request,
    });
    const pageId = Number(pageDraft.page.id);
    const pageVersion = latestVersion(pageDraft);

    const pageSubmitted = await submitPageVersion({
      pageId,
      versionId: pageVersion.id,
      assignedTo: reviewer.id,
      note: "Please verify the exact acceptance page version.",
      user: author,
      req: request,
    });
    const pageApproval = pendingApproval(
      pageSubmitted,
      pageVersion.id,
      "page_version_id"
    );

    await assert.rejects(
      () =>
        decidePageApproval({
          approvalId: pageApproval.id,
          decision: "approved",
          note: "Self approval must fail.",
          user: author,
          req: request,
        }),
      (error) => error?.code === "CONTENT_SELF_APPROVAL_BLOCKED"
    );

    await decidePageApproval({
      approvalId: pageApproval.id,
      decision: "approved",
      note: "Independent reviewer approved the exact version.",
      user: reviewer,
      req: request,
    });
    await publishPageVersion({
      pageId,
      versionId: pageVersion.id,
      user: publisher,
      req: request,
    });

    const publicPage = await getPublicPageBySlug("acceptance-home");
    assert.equal(publicPage?.title, "CHALIN ONE Acceptance Home");
    assert.equal(publicPage?.sections?.length, 1);
    assert.equal(
      publicPage.sections[0]?.content?.text,
      "The acceptance database rendered this published section."
    );

    const formDraft = await createFormDraft({
      input: {
        form_key: "acceptance_contact",
        slug: "acceptance-contact",
        name: "Acceptance Contact Form",
        form_type: "contact",
        description: "Database-backed public form acceptance.",
        confirmation_message: "Your acceptance enquiry was received.",
        settings: {
          require_contact: true,
          require_consent: true,
          submit_label: "Send enquiry",
          consent_text_version: "privacy-v1",
        },
        fields: [
          {
            field_key: "subject",
            field_type: "text",
            label: "Subject",
            is_required: true,
            validation: { max_length: 120 },
            sort_order: 0,
          },
          {
            field_key: "message",
            field_type: "textarea",
            label: "Message",
            is_required: true,
            validation: { max_length: 1000 },
            sort_order: 1,
          },
        ],
        change_summary: "Initial acceptance form",
      },
      user: author,
      req: request,
    });
    const formId = Number(formDraft.form.id);
    const formVersion = latestVersion(formDraft);
    const formSubmitted = await submitFormVersion({
      formId,
      versionId: formVersion.id,
      assignedTo: reviewer.id,
      note: "Review the exact form definition.",
      user: author,
      req: request,
    });
    const formApproval = pendingApproval(formSubmitted, formVersion.id);

    await decideFormApproval({
      approvalId: formApproval.id,
      decision: "approved",
      note: "Form definition approved.",
      user: reviewer,
      req: request,
    });
    await publishFormVersion({
      formId,
      versionId: formVersion.id,
      user: publisher,
      req: request,
    });

    const publicForm = await getPublicFormBySlug("acceptance-contact");
    assert.equal(publicForm?.name, "Acceptance Contact Form");
    assert.deepEqual(
      publicForm?.fields?.map((field) => field.key),
      ["subject", "message"]
    );

    const submission = await createPublicFormSubmission({
      formSlug: "acceptance-contact",
      payload: {
        full_name: "Acceptance Customer",
        email: "acceptance@example.com",
        consent_given: true,
        consent_text_version: "privacy-v1",
        source_page_slug: "acceptance-home",
        source_url: "https://example.com/website/forms/acceptance-contact",
        responses: {
          subject: "Database acceptance",
          message: "The public submission protocol is working.",
        },
      },
      requestContext: {
        ip: "127.0.0.1",
        userAgent: "CHALIN-ONE-Acceptance",
        requestId: request.requestId,
      },
    });
    assert.equal(submission?.accepted, true);
    assert.match(String(submission?.reference_code || ""), /^WEB-/);

    const submissionList = await listSubmissions({
      status: "new",
      search: "acceptance@example.com",
      limit: 10,
      offset: 0,
    });
    assert.equal(submissionList.total, 1);
    const submissionDetails = await getSubmissionDetails(
      submissionList.items[0].id
    );
    assert.equal(submissionDetails.submission.email, "acceptance@example.com");
    assert.equal(submissionDetails.submission.ip_hash, undefined);
    assert.equal(submissionDetails.submission.user_agent, undefined);

    const navigationItems = await createNavigationDraft({
      input: {
        navigation_key: "acceptance_home",
        navigation_location: "header",
        label: "Home",
        page_id: pageId,
        sort_order: 0,
        opens_new_tab: false,
        change_summary: "Initial acceptance navigation",
      },
      user: author,
      req: request,
    });
    const navigationItem = navigationItems.find(
      (item) => item.navigation_key === "acceptance_home"
    );
    assert.ok(navigationItem?.latest_version_id);

    await submitNavigationVersion({
      itemId: navigationItem.id,
      versionId: navigationItem.latest_version_id,
      assignedTo: reviewer.id,
      note: "Review the exact navigation version.",
      user: author,
      req: request,
    });
    const navigationApprovals = await listNavigationApprovals({
      assignedTo: reviewer.id,
      limit: 10,
      offset: 0,
    });
    const navigationApproval = navigationApprovals.items.find(
      (item) => Number(item.entity_id) === Number(navigationItem.id)
    );
    assert.equal(
      Number(navigationApproval?.content_version_id),
      Number(navigationItem.latest_version_id)
    );

    await decideNavigationApproval({
      approvalId: navigationApproval.id,
      decision: "approved",
      note: "Navigation approved.",
      user: reviewer,
      req: request,
    });
    await publishNavigationVersion({
      itemId: navigationItem.id,
      versionId: navigationItem.latest_version_id,
      user: publisher,
      req: request,
    });

    await upsertSiteSetting({
      input: {
        setting_key: "site.name",
        setting_group: "site",
        value: "CHALIN ONE Acceptance",
        description: "Database acceptance website name",
        is_public: true,
        is_active: true,
      },
      user: publisher,
      req: request,
    });

    const bootstrap = await getPublicBootstrap();
    assert.equal(bootstrap.settings["site.name"], "CHALIN ONE Acceptance");
    assert.equal(
      bootstrap.navigation.some(
        (item) => item.key === "acceptance_home" && item.url === "/acceptance-home"
      ),
      true
    );

    const dashboard = await getContentStudioDashboard();
    assert.equal(Number(dashboard.pages.published_pages), 1);
    assert.equal(Number(dashboard.submissions.new_submissions), 1);
    assert.equal(Number(dashboard.approvals.pending_approvals), 0);
  }
);

test.after(async () => {
  await pool.end();
});
