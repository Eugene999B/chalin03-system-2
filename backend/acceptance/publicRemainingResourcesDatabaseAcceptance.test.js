"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { pool } = require("../config/db");
const portfolio = require("../services/contentStudioPortfolioService");
const companyInfo = require("../services/contentStudioCompanyInfoService");
const {
  getPublicTenderBySlug,
  getPublicVacancyBySlug,
  listPublicLeadership,
  listPublicLocations,
  listPublicTenders,
  listPublicVacancies,
} = require("../services/publicContentService");

const author = Object.freeze({ id: 1, full_name: "Acceptance Author" });
const reviewer = Object.freeze({ id: 2, full_name: "Acceptance Reviewer" });
const publisher = Object.freeze({ id: 3, full_name: "Acceptance Publisher" });
const request = Object.freeze({
  requestId: "chalin-one-remaining-public-acceptance",
  headers: {},
});

function relativeUtc(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

const OPENS_AT = relativeUtc(-1);
const CLOSES_AT = relativeUtc(30);

const PRIVATE_FIELD_NAMES = new Set([
  "id",
  "entity_id",
  "content_version_id",
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
    `${label} must not expose workflow, database, storage or request identifiers.`
  );
}

test(
  "leadership, locations, vacancies and tenders publish through exact approved versions",
  { timeout: 120000 },
  async () => {
    const [[databaseRow]] = await pool.query("SELECT DATABASE() AS database_name");
    assert.match(
      String(databaseRow?.database_name || ""),
      /^chalin_one_acceptance(?:_[a-z0-9_]+)?$/i
    );

    const [[divisionRow]] = await pool.query(
      "SELECT id FROM public_business_divisions WHERE division_key = ? LIMIT 1",
      ["acceptance_mining"]
    );
    const divisionId = Number(divisionRow?.id);
    assert.ok(
      divisionId,
      "The earlier serial collection acceptance must publish the shared division."
    );

    await publishGoverned(portfolio, "leadership", {
      profile_key: "acceptance_director",
      slug: "acceptance-director",
      full_name: "Ama Acceptance",
      position_title: "Director of Acceptance",
      professional_summary:
        "Leads controlled verification for public and operational delivery.",
      biography: {
        text: "Ama oversees independent review, publication controls and release evidence.",
      },
      social_links: {
        website: "https://preview.example-chalin03.com/leadership/ama",
        email: "mailto:ama.acceptance@example.com",
        phone: "tel:+233240000001",
      },
      sort_order: 10,
      change_summary: "Create acceptance leadership profile",
    });

    const leadership = await listPublicLeadership();
    const leader = leadership.find((item) => item.slug === "acceptance-director");
    assert.equal(leader?.key, "acceptance_director");
    assert.equal(leader?.full_name, "Ama Acceptance");
    assert.equal(leader?.position, "Director of Acceptance");
    assert.equal(
      leader?.biography?.text,
      "Ama oversees independent review, publication controls and release evidence."
    );
    assert.equal(
      leader?.social_links?.email,
      "mailto:ama.acceptance@example.com"
    );
    assert.equal(leader?.portrait, null);
    assertPublicOnly("Leadership collection", leadership);

    const locationPublication = await publishGoverned(companyInfo, "location", {
      location_key: "acceptance_head_office",
      slug: "acceptance-head-office",
      division_id: divisionId,
      name: "Acceptance Head Office",
      location_type: "office",
      address_line: "1 Acceptance Avenue",
      city: "Dunkwa-on-Offin",
      region: "Central Region",
      country: "Ghana",
      latitude: 5.965,
      longitude: -1.7805,
      phone: "+233 24 000 0002",
      email: "office.acceptance@example.com",
      business_hours: {
        weekdays: "08:00–17:00",
        saturday: "09:00–13:00",
      },
      map_url: "https://maps.example.com/acceptance-head-office",
      sort_order: 10,
      change_summary: "Create acceptance location",
    });

    const locations = await listPublicLocations({
      divisionSlug: "acceptance-mining",
    });
    const location = locations.find(
      (item) => item.slug === "acceptance-head-office"
    );
    assert.equal(location?.key, "acceptance_head_office");
    assert.equal(location?.address, "1 Acceptance Avenue");
    assert.equal(location?.phone, "+233 24 000 0002");
    assert.equal(location?.email, "office.acceptance@example.com");
    assert.equal(Number(location?.coordinates?.latitude), 5.965);
    assert.equal(Number(location?.coordinates?.longitude), -1.7805);
    assert.equal(location?.division?.slug, "acceptance-mining");
    assert.equal(location?.business_hours?.weekdays, "08:00–17:00");
    assertPublicOnly("Location collection", locations);

    await publishGoverned(companyInfo, "vacancy", {
      vacancy_key: "acceptance_operations_officer",
      slug: "acceptance-operations-officer",
      division_id: divisionId,
      location_id: locationPublication.entityId,
      title: "Acceptance Operations Officer",
      employment_type: "Full-time",
      summary: "Coordinate governed operational and public-content acceptance.",
      description: {
        text: "Support controlled releases, evidence gathering and workflow verification.",
      },
      requirements: [
        "Strong operational discipline",
        "Experience with evidence-based review",
      ],
      application_instructions: {
        text: "Apply through the approved staging recruitment form.",
      },
      application_url:
        "https://preview.example-chalin03.com/forms/acceptance-careers",
      vacancies_count: 2,
      opens_at: OPENS_AT,
      closes_at: CLOSES_AT,
      sort_order: 10,
      change_summary: "Create acceptance vacancy",
    });

    const vacancies = await listPublicVacancies({
      divisionSlug: "acceptance-mining",
      limit: 20,
      offset: 0,
    });
    assert.equal(vacancies.total, 1);
    assert.equal(vacancies.items[0]?.slug, "acceptance-operations-officer");
    assert.equal(vacancies.items[0]?.vacancies_count, 2);
    assert.equal(vacancies.items[0]?.location?.slug, "acceptance-head-office");
    assert.equal(
      vacancies.items[0]?.application_url,
      "https://preview.example-chalin03.com/forms/acceptance-careers"
    );
    assertPublicOnly("Vacancy collection", vacancies);

    const vacancy = await getPublicVacancyBySlug(
      "acceptance-operations-officer"
    );
    assert.equal(vacancy?.employment_type, "Full-time");
    assert.equal(
      vacancy?.description?.text,
      "Support controlled releases, evidence gathering and workflow verification."
    );
    assert.deepEqual(vacancy?.requirements, [
      "Strong operational discipline",
      "Experience with evidence-based review",
    ]);
    assert.equal(
      vacancy?.application_instructions?.text,
      "Apply through the approved staging recruitment form."
    );
    assertPublicOnly("Vacancy detail", vacancy);

    await publishGoverned(companyInfo, "tender", {
      tender_key: "acceptance_service_tender",
      slug: "acceptance-service-tender",
      division_id: divisionId,
      reference_number: "CH1-ACC-2026-001",
      title: "Acceptance Service Tender",
      summary: "A controlled procurement notice used for database acceptance.",
      details: {
        text: "Qualified suppliers may submit proposals for acceptance support services.",
      },
      submission_instructions: {
        text: "Submit through the approved procurement channel before the deadline.",
      },
      opens_at: OPENS_AT,
      closes_at: CLOSES_AT,
      document_media_asset_id: null,
      sort_order: 10,
      change_summary: "Create acceptance tender",
    });

    const tenders = await listPublicTenders({
      divisionSlug: "acceptance-mining",
      limit: 20,
      offset: 0,
    });
    assert.equal(tenders.total, 1);
    assert.equal(tenders.items[0]?.slug, "acceptance-service-tender");
    assert.equal(tenders.items[0]?.reference_number, "CH1-ACC-2026-001");
    assert.equal(tenders.items[0]?.document, null);
    assertPublicOnly("Tender collection", tenders);

    const tender = await getPublicTenderBySlug("acceptance-service-tender");
    assert.equal(
      tender?.details?.text,
      "Qualified suppliers may submit proposals for acceptance support services."
    );
    assert.equal(
      tender?.submission_instructions?.text,
      "Submit through the approved procurement channel before the deadline."
    );
    assert.equal(tender?.division?.slug, "acceptance-mining");
    assert.equal(tender?.document, null);
    assertPublicOnly("Tender detail", tender);

    const [auditRows] = await pool.query(
      `SELECT entity_type, action_key, actor_user_id
         FROM public_content_audit_log
        WHERE request_id = ?
          AND action_key LIKE '%_published'
        ORDER BY id`,
      [request.requestId]
    );
    assert.equal(auditRows.length, 4);
    assert.deepEqual(
      new Set(auditRows.map((row) => row.entity_type)),
      new Set(["leadership_profile", "location", "job_vacancy", "tender"])
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
