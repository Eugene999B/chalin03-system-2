"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { pool } = require("../config/db");
const newsroom = require("../services/contentStudioNewsroomService");
const portfolio = require("../services/contentStudioPortfolioService");
const companyInfo = require("../services/contentStudioCompanyInfoService");
const {
  getPublicDivisionBySlug,
  getPublicEquipmentBySlug,
  getPublicNewsBySlug,
  getPublicProjectBySlug,
  listPublicDivisions,
  listPublicEquipment,
  listPublicFaqs,
  listPublicNews,
  listPublicProjects,
} = require("../services/publicContentService");
const {
  listPublicTestimonials,
} = require("../services/publicTestimonialService");

const author = Object.freeze({ id: 1, full_name: "Acceptance Author" });
const reviewer = Object.freeze({ id: 2, full_name: "Acceptance Reviewer" });
const publisher = Object.freeze({ id: 3, full_name: "Acceptance Publisher" });
const request = Object.freeze({
  requestId: "chalin-one-public-collections-acceptance",
  headers: {},
});

const PRIVATE_FIELD_NAMES = new Set([
  "id",
  "entity_id",
  "content_version_id",
  "page_version_id",
  "internal_page_version_id",
  "internal_project_id",
  "snapshot_json",
  "storage_key",
  "requested_by",
  "assigned_to",
  "decided_by",
  "approved_by",
  "published_by",
  "created_by",
  "updated_by",
  "ip_hash",
  "user_agent",
]);

function latestVersion(details) {
  const version = details?.versions?.[0];
  assert.ok(version?.id, "A governed draft must return its exact version ID.");
  return version;
}

function pendingApproval(details, versionId) {
  const approval = details?.approvals?.find(
    (item) =>
      item.approval_status === "pending" &&
      Number(item.content_version_id) === Number(versionId)
  );
  assert.ok(approval?.id, "The exact submitted version must have a pending approval.");
  return approval;
}

async function publishGoverned(service, kind, input) {
  const draft = await service.createEntityDraft({
    kind,
    input,
    user: author,
    req: request,
  });
  const entityId = Number(draft?.entity?.id);
  assert.ok(entityId, `${kind} draft must return an entity ID.`);
  const version = latestVersion(draft);

  const submitted = await service.submitEntityVersion({
    kind,
    entityId,
    versionId: version.id,
    assignedTo: reviewer.id,
    note: `Review the exact ${kind} acceptance version.`,
    user: author,
    req: request,
  });
  const approval = pendingApproval(submitted, version.id);

  await service.decideEntityApproval({
    kind,
    approvalId: approval.id,
    decision: "approved",
    note: `Independent approval for ${kind} acceptance.`,
    user: reviewer,
    req: request,
  });
  await service.publishEntityVersion({
    kind,
    entityId,
    versionId: version.id,
    user: publisher,
    req: request,
  });

  return { entityId, versionId: Number(version.id) };
}

function privateFieldFindings(value, trail = [], findings = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      privateFieldFindings(item, [...trail, String(index)], findings)
    );
    return findings;
  }
  if (!value || typeof value !== "object") return findings;

  for (const [key, item] of Object.entries(value)) {
    if (PRIVATE_FIELD_NAMES.has(String(key).toLowerCase())) {
      findings.push([...trail, key].join("."));
    }
    privateFieldFindings(item, [...trail, key], findings);
  }
  return findings;
}

function assertPublicOnly(label, value) {
  assert.deepEqual(
    privateFieldFindings(value),
    [],
    `${label} must not expose database, workflow, storage or request identifiers.`
  );
}

test(
  "governed Newsroom, Portfolio and Company Information publish safe public shapes",
  { timeout: 120000 },
  async () => {
    const [[databaseRow]] = await pool.query("SELECT DATABASE() AS database_name");
    assert.match(
      String(databaseRow?.database_name || ""),
      /^chalin_one_acceptance(?:_[a-z0-9_]+)?$/i
    );

    await publishGoverned(companyInfo, "division", {
      division_key: "acceptance_mining",
      slug: "acceptance-mining",
      name: "Acceptance Mining Operations",
      short_description: "Database-backed public division acceptance.",
      body: {
        text: "This approved division proves governed company-information delivery.",
      },
      contact_phone: "+233 24 000 0000",
      contact_email: "acceptance-division@example.com",
      sort_order: 10,
      change_summary: "Create acceptance division",
    });

    const divisions = await listPublicDivisions();
    const division = divisions.find((item) => item.slug === "acceptance-mining");
    assert.equal(division?.key, "acceptance_mining");
    assert.equal(division?.name, "Acceptance Mining Operations");
    assert.equal(
      division?.contact?.email,
      "acceptance-division@example.com"
    );
    assertPublicOnly("Division collection", divisions);

    const divisionDetails = await getPublicDivisionBySlug("acceptance-mining");
    assert.equal(
      divisionDetails?.body?.text,
      "This approved division proves governed company-information delivery."
    );
    assert.equal(
      divisionDetails?.contact?.phone,
      "+233 24 000 0000"
    );
    assertPublicOnly("Division detail", divisionDetails);

    const [[divisionRow]] = await pool.query(
      "SELECT id FROM public_business_divisions WHERE division_key = ? LIMIT 1",
      ["acceptance_mining"]
    );
    const divisionId = Number(divisionRow?.id);
    assert.ok(divisionId);

    await publishGoverned(newsroom, "article", {
      article_key: "acceptance_news",
      slug: "acceptance-news",
      title: "CHALIN ONE Acceptance News",
      excerpt: "A real database-backed Newsroom publication.",
      body: {
        text: "This article was independently reviewed and published from the isolated acceptance database.",
      },
      author_display_name: "Acceptance Communications",
      is_featured: false,
      seo_title: "Acceptance News",
      meta_description: "Governed Newsroom acceptance content.",
      change_summary: "Create acceptance Newsroom article",
    });

    await newsroom.createEntityDraft({
      kind: "article",
      input: {
        article_key: "acceptance_private_draft",
        slug: "acceptance-private-draft",
        title: "Private Acceptance Draft",
        excerpt: "This draft must never be public.",
        body: { text: "Unpublished acceptance content." },
        change_summary: "Create unpublished privacy probe",
      },
      user: author,
      req: request,
    });

    const news = await listPublicNews({ limit: 20, offset: 0 });
    assert.equal(news.total, 1);
    assert.equal(news.items[0]?.slug, "acceptance-news");
    assert.equal(
      news.items.some((item) => item.slug === "acceptance-private-draft"),
      false
    );
    assertPublicOnly("News collection", news);

    const newsDetails = await getPublicNewsBySlug("acceptance-news");
    assert.equal(newsDetails?.author, "Acceptance Communications");
    assert.equal(
      newsDetails?.body?.text,
      "This article was independently reviewed and published from the isolated acceptance database."
    );
    assert.equal(await getPublicNewsBySlug("acceptance-private-draft"), null);
    assertPublicOnly("News detail", newsDetails);

    await publishGoverned(portfolio, "project", {
      project_key: "acceptance_project",
      slug: "acceptance-project",
      division_id: divisionId,
      title: "Acceptance Mining Project",
      summary: "A governed public project backed by MySQL acceptance.",
      body: {
        text: "The project detail response contains approved structured content only.",
      },
      location_text: "Dunkwa-on-Offin, Ghana",
      operational_status: "active",
      start_date: "2026-01-15",
      end_date: null,
      gallery: [],
      sort_order: 10,
      change_summary: "Create acceptance project",
    });

    const projects = await listPublicProjects({
      divisionSlug: "acceptance-mining",
      status: "active",
      limit: 20,
      offset: 0,
    });
    assert.equal(projects.total, 1);
    assert.equal(projects.items[0]?.slug, "acceptance-project");
    assert.equal(projects.items[0]?.division?.slug, "acceptance-mining");
    assertPublicOnly("Project collection", projects);

    const projectDetails = await getPublicProjectBySlug("acceptance-project");
    assert.equal(projectDetails?.status, "active");
    assert.equal(projectDetails?.gallery?.length, 0);
    assert.equal(
      projectDetails?.body?.text,
      "The project detail response contains approved structured content only."
    );
    assertPublicOnly("Project detail", projectDetails);

    await publishGoverned(portfolio, "equipment", {
      equipment_key: "acceptance_excavator",
      slug: "acceptance-excavator",
      division_id: divisionId,
      internal_reference_type: "external",
      internal_reference_id: null,
      name: "Acceptance 20-Ton Excavator",
      manufacturer: "Acceptance Machinery",
      model: "AX-20",
      model_year: 2025,
      equipment_category: "Excavator",
      condition_label: "Work ready",
      availability_status: "available",
      short_description: "Public equipment acceptance item.",
      specifications: {
        operating_weight: "20 tonnes",
        engine_power: "120 kW",
      },
      features: ["Operator cabin", "Hydraulic quick coupler"],
      currency_code: "GHS",
      display_price: 850000,
      show_price: true,
      hire_available: true,
      finance_available: true,
      sort_order: 10,
      change_summary: "Create acceptance equipment",
    });

    const equipment = await listPublicEquipment({
      divisionSlug: "acceptance-mining",
      availability: "available",
      hireAvailable: true,
      financeAvailable: true,
      search: "Excavator",
      limit: 20,
      offset: 0,
    });
    assert.equal(equipment.total, 1);
    assert.equal(equipment.items[0]?.slug, "acceptance-excavator");
    assert.equal(equipment.items[0]?.price?.currency, "GHS");
    assert.equal(Number(equipment.items[0]?.price?.amount), 850000);
    assert.equal(equipment.items[0]?.hire_available, true);
    assert.equal(equipment.items[0]?.finance_available, true);
    assertPublicOnly("Equipment collection", equipment);

    const equipmentDetails = await getPublicEquipmentBySlug(
      "acceptance-excavator"
    );
    assert.equal(equipmentDetails?.availability, "available");
    assert.equal(Number(equipmentDetails?.price?.amount), 850000);
    assert.equal(equipmentDetails?.specifications?.operating_weight, "20 tonnes");
    assert.deepEqual(equipmentDetails?.features, [
      "Operator cabin",
      "Hydraulic quick coupler",
    ]);
    assertPublicOnly("Equipment detail", equipmentDetails);

    await publishGoverned(companyInfo, "faq", {
      faq_key: "acceptance_delivery",
      category_label: "Acceptance",
      question: "Does CHALIN ONE protect unpublished content?",
      answer: {
        text: "Yes. Only exact independently approved and published versions are public.",
      },
      sort_order: 10,
      change_summary: "Create acceptance FAQ",
    });

    const faqs = await listPublicFaqs({ category: "Acceptance" });
    assert.equal(faqs.length, 1);
    assert.equal(faqs[0]?.key, "acceptance_delivery");
    assert.equal(
      faqs[0]?.answer?.text,
      "Yes. Only exact independently approved and published versions are public."
    );
    assertPublicOnly("FAQ collection", faqs);

    await publishGoverned(companyInfo, "testimonial", {
      testimonial_key: "acceptance_customer",
      customer_display_name: "Acceptance Customer",
      customer_title: "Operations Manager",
      company_name: "Acceptance Industries",
      quote_text: "The governed publication workflow is clear and dependable.",
      rating: 5,
      sort_order: 10,
      change_summary: "Create acceptance testimonial",
    });

    const testimonials = await listPublicTestimonials({ limit: 20 });
    assert.equal(testimonials.length, 1);
    assert.equal(testimonials[0]?.key, "acceptance_customer");
    assert.equal(testimonials[0]?.customer_name, "Acceptance Customer");
    assert.equal(testimonials[0]?.rating, 5);
    assertPublicOnly("Testimonial collection", testimonials);

    const [auditRows] = await pool.query(
      `SELECT entity_type, action_key, actor_user_id
         FROM public_content_audit_log
        WHERE request_id = ?
          AND action_key LIKE '%_published'
        ORDER BY id`,
      [request.requestId]
    );
    assert.equal(auditRows.length, 6);
    assert.deepEqual(
      new Set(auditRows.map((row) => row.entity_type)),
      new Set([
        "business_division",
        "news_article",
        "project",
        "equipment",
        "faq",
        "testimonial",
      ])
    );
    assert.equal(
      auditRows.every((row) => Number(row.actor_user_id) === publisher.id),
      true
    );
  }
);

test.after(async () => {
  await pool.end();
});
