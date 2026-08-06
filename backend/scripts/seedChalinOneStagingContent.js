"use strict";

const { pool } = require("../config/db");
const {
  createPageDraft,
  normalizePageKey,
  normalizeSlug,
  sanitizeVersionInput,
} = require("../services/contentStudioPageService");
const {
  createFormDraft,
  sanitizeFormSnapshot,
} = require("../services/contentStudioFormService");
const {
  createEntityDraft,
  sanitizeSnapshot,
} = require("../services/contentStudioCompanyInfoService");
const {
  createNavigationDraft,
  sanitizeNavigationSnapshot,
} = require("../services/contentStudioNavigationService");
const {
  assertPublicSettingAllowed,
  normalizeSettingKey,
  upsertSiteSetting,
} = require("../services/contentStudioSettingsService");
const {
  validateStagingEnvironment,
} = require("./verifyChalinOneStagingEnvironment");

const MIGRATION_RECORD =
  "20260805_chalin_one_public_content_foundation";
const REQUEST = Object.freeze({
  requestId: "chalin-one-staging-seed",
  headers: {},
});

const STAGING_SEED_MANIFEST = Object.freeze({
  settings: Object.freeze([
    {
      setting_key: "site.name",
      setting_group: "site",
      value: "CHALIN 03 COMPANY LIMITED",
      description: "Public company name shown in the staging website header.",
      is_public: true,
      is_active: true,
    },
    {
      setting_key: "site.tagline",
      setting_group: "site",
      value: "Integrated business, equipment and operational solutions",
      description: "Staging website headline. Management must approve final wording.",
      is_public: true,
      is_active: true,
    },
    {
      setting_key: "site.description",
      setting_group: "site",
      value:
        "CHALIN 03 brings together spare parts, mining operations, equipment hire, equipment sales and installment finance through one professionally governed platform.",
      description: "Public staging description for search and website summaries.",
      is_public: true,
      is_active: true,
    },
    {
      setting_key: "site.brand",
      setting_group: "site",
      value: {
        primary: "#0a2342",
        surface: "#ffffff",
        muted_surface: "#f4f7fb",
        success: "#1f7a4d",
        warning: "#c56a13",
        danger: "#b42318",
      },
      description: "Approved CHALIN ONE staging colour tokens.",
      is_public: true,
      is_active: true,
    },
    {
      setting_key: "site.footer",
      setting_group: "site",
      value: {
        company_name: "CHALIN 03 COMPANY LIMITED",
        staff_login_path: "/login",
        notice:
          "Published information is reviewed and controlled through CHALIN ONE Content Studio.",
      },
      description: "Public footer content for the staging preview.",
      is_public: true,
      is_active: true,
    },
    {
      setting_key: "company.safety_commitment",
      setting_group: "company",
      value: {
        text:
          "Safety, responsible operations and accurate documentation remain central to every CHALIN 03 business workflow.",
      },
      description: "Draft public safety statement requiring management review.",
      is_public: true,
      is_active: true,
    },
    {
      setting_key: "company.quality_commitment",
      setting_group: "company",
      value: {
        text:
          "CHALIN 03 is committed to dependable service, controlled processes and continuous operational improvement.",
      },
      description: "Draft public quality statement requiring management review.",
      is_public: true,
      is_active: true,
    },
  ]),
  pages: Object.freeze([
    {
      page_key: "home",
      slug: "home",
      page_type: "homepage",
      template_key: "corporate_home",
      menu_title: "Home",
      is_homepage: true,
      show_in_search: true,
      show_in_sitemap: true,
      title: "Integrated solutions for demanding operations",
      subtitle:
        "One group platform for equipment, mining, hire, finance and commercial support",
      summary:
        "Discover CHALIN 03 businesses, projects, equipment and opportunities through a governed public platform.",
      body: {
        text:
          "This homepage draft is intentionally factual and neutral. Management should review every statement and add approved media before publication.",
      },
      seo_title: "CHALIN 03 COMPANY LIMITED",
      meta_description:
        "Explore CHALIN 03 business divisions, equipment, projects, news and public opportunities.",
      change_summary: "Create the initial governed staging homepage",
      sections: [
        {
          section_key: "home_introduction",
          section_type: "text",
          heading: "One connected operating group",
          subheading:
            "Specialist business divisions supported by shared governance and technology",
          content: {
            text:
              "CHALIN 03 combines established operational workflows with a professional public information and enquiry platform.",
          },
          settings: { width: "wide", alignment: "left" },
          sort_order: 10,
          is_enabled: true,
        },
        {
          section_key: "home_divisions",
          section_type: "divisions",
          heading: "Our business divisions",
          subheading: "Explore the services available across the group",
          content: {
            text:
              "Division profiles are published only after independent review and approval.",
          },
          settings: { limit: 5 },
          sort_order: 20,
          is_enabled: true,
        },
        {
          section_key: "home_safety_quality",
          section_type: "split",
          heading: "Safety, quality and accountability",
          content: {
            safety:
              "Operational safety and responsible record keeping are built into the platform.",
            quality:
              "Published information is version controlled, reviewed and auditable.",
          },
          settings: { columns: 2 },
          sort_order: 30,
          is_enabled: true,
        },
        {
          section_key: "home_contact_action",
          section_type: "cta",
          heading: "Start a professional enquiry",
          subheading:
            "Tell us which service you need and the appropriate team can review your request.",
          content: {
            label: "Contact CHALIN 03",
            url: "/contact",
          },
          settings: { emphasis: "primary" },
          sort_order: 40,
          is_enabled: true,
        },
      ],
    },
    {
      page_key: "about",
      slug: "about",
      page_type: "company",
      template_key: "standard",
      menu_title: "About",
      is_homepage: false,
      show_in_search: true,
      show_in_sitemap: true,
      title: "About CHALIN 03",
      subtitle: "A connected platform serving multiple operational businesses",
      summary:
        "Learn how CHALIN 03 combines specialist divisions with shared governance, technology and customer service.",
      body: {
        text:
          "CHALIN 03 COMPANY LIMITED operates through specialist business divisions supported by one secure operations platform. Final company history, registration details and leadership statements must be verified before publication.",
      },
      seo_title: "About CHALIN 03 COMPANY LIMITED",
      meta_description:
        "Learn about CHALIN 03, its business divisions and its commitment to controlled professional operations.",
      change_summary: "Create the initial governed About page",
      sections: [
        {
          section_key: "about_structure",
          section_type: "divisions",
          heading: "Specialist divisions, shared standards",
          content: {
            text:
              "Each public division profile is maintained independently while following the same review and approval controls.",
          },
          settings: { limit: 5 },
          sort_order: 10,
          is_enabled: true,
        },
        {
          section_key: "about_governance",
          section_type: "text",
          heading: "Professional governance",
          content: {
            items: [
              "Controlled business workflows",
              "Permission-based staff access",
              "Audited content and operational changes",
              "Independent review for public publication",
            ],
          },
          settings: { width: "standard" },
          sort_order: 20,
          is_enabled: true,
        },
      ],
    },
    {
      page_key: "contact",
      slug: "contact",
      page_type: "contact",
      template_key: "contact",
      menu_title: "Contact",
      is_homepage: false,
      show_in_search: true,
      show_in_sitemap: true,
      title: "Contact CHALIN 03",
      subtitle: "Send a clear enquiry to the appropriate business team",
      summary:
        "Use the governed contact form to request information about equipment, hire, finance, mining or spare parts.",
      body: {
        text:
          "Verified office addresses, phone numbers and business hours should be added through the Locations and Website Settings managers before public launch.",
      },
      seo_title: "Contact CHALIN 03",
      meta_description:
        "Send a professional enquiry to CHALIN 03 about equipment, hire, finance, mining or spare parts.",
      change_summary: "Create the initial governed Contact page",
      sections: [
        {
          section_key: "contact_form",
          section_type: "form",
          heading: "How can we help?",
          subheading:
            "Provide accurate contact information and a short description of your request.",
          content: { form_slug: "contact" },
          settings: { show_reference_after_submit: true },
          sort_order: 10,
          is_enabled: true,
        },
        {
          section_key: "contact_privacy",
          section_type: "text",
          heading: "Your information",
          content: {
            text:
              "Submitted information is used to review and respond to the enquiry. Sensitive operational or financial records should not be entered into a general public form.",
          },
          settings: { tone: "muted" },
          sort_order: 20,
          is_enabled: true,
        },
      ],
    },
  ]),
  divisions: Object.freeze([
    {
      division_key: "spare_parts",
      slug: "spare-parts",
      name: "Spare Parts",
      short_description:
        "Parts sales, stock support and customer service delivered through the established CHALIN 03 operating system.",
      body: {
        text:
          "This draft profile should be expanded with approved product categories, service standards and verified contact information.",
      },
      sort_order: 10,
      change_summary: "Create the Spare Parts public draft",
    },
    {
      division_key: "mining_operations",
      slug: "mining-operations",
      name: "Mining Operations",
      short_description:
        "Controlled site operations, production reporting, equipment activity and operational oversight.",
      body: {
        text:
          "Only approved public information may be published. Production, fuel, incident and personnel records remain private.",
      },
      sort_order: 20,
      change_summary: "Create the Mining Operations public draft",
    },
    {
      division_key: "equipment_hire",
      slug: "equipment-hire",
      name: "Equipment Hire",
      short_description:
        "Equipment availability, quotation, contracting, dispatch and return workflows for approved hire engagements.",
      body: {
        text:
          "Public equipment availability is separate from private contracts, customer records and operational work logs.",
      },
      sort_order: 30,
      change_summary: "Create the Equipment Hire public draft",
    },
    {
      division_key: "equipment_sales",
      slug: "equipment-sales",
      name: "Equipment Sales",
      short_description:
        "Public equipment catalogue and professional sales enquiry support for approved machines and assets.",
      body: {
        text:
          "Pricing and availability appear publicly only when specifically approved for display.",
      },
      sort_order: 40,
      change_summary: "Create the Equipment Sales public draft",
    },
    {
      division_key: "installment_finance",
      slug: "installment-finance",
      name: "Installment Finance",
      short_description:
        "Structured equipment application and repayment workflows with controlled review, documentation and approval.",
      body: {
        text:
          "The public website may explain requirements and accept enquiries, but private applications and approval decisions remain inside the protected staff system.",
      },
      sort_order: 50,
      change_summary: "Create the Installment Finance public draft",
    },
  ]),
  statistics: Object.freeze([
    {
      statistic_key: "business_divisions",
      label: "Connected business divisions",
      display_value: "5",
      numeric_value: 5,
      source_note:
        "Based on the five currently defined CHALIN 03 operating divisions; confirm before publication.",
      sort_order: 10,
      change_summary: "Create the staging business-division statistic",
    },
  ]),
  faqs: Object.freeze([
    {
      faq_key: "services_available",
      category_label: "Company services",
      question: "Which services are available through CHALIN 03?",
      answer: {
        text:
          "The public platform presents approved information about Spare Parts, Mining Operations, Equipment Hire, Equipment Sales and Installment Finance.",
      },
      sort_order: 10,
      change_summary: "Create the services FAQ draft",
    },
    {
      faq_key: "request_quotation",
      category_label: "Enquiries",
      question: "How do I request a quotation or more information?",
      answer: {
        text:
          "Use the public contact form and select the relevant service. The enquiry will enter the protected Enquiry Desk for staff review.",
      },
      sort_order: 20,
      change_summary: "Create the quotation FAQ draft",
    },
    {
      faq_key: "installment_application_privacy",
      category_label: "Installment Finance",
      question: "Can I submit private finance documents through the general contact form?",
      answer: {
        text:
          "No. The general contact form is for enquiries only. Private application documents must use the dedicated secure workflow when staff provide access.",
      },
      sort_order: 30,
      change_summary: "Create the finance privacy FAQ draft",
    },
  ]),
  forms: Object.freeze([
    {
      form_key: "general_contact",
      slug: "contact",
      name: "Contact CHALIN 03",
      form_type: "contact",
      description:
        "General public enquiry form for approved CHALIN 03 services.",
      confirmation_message:
        "Thank you. Your enquiry has been received and assigned a reference code.",
      settings: {
        require_contact: true,
        require_consent: true,
        submit_label: "Send enquiry",
        consent_text_version: "privacy-v1",
      },
      fields: [
        {
          field_key: "service_interest",
          field_type: "select",
          label: "Service required",
          placeholder: "Choose a service",
          is_required: true,
          options: [
            "Spare Parts",
            "Mining Operations",
            "Equipment Hire",
            "Equipment Sales",
            "Installment Finance",
            "General company enquiry",
          ],
          sort_order: 10,
        },
        {
          field_key: "subject",
          field_type: "text",
          label: "Subject",
          placeholder: "What is your enquiry about?",
          is_required: true,
          validation: { max_length: 160 },
          sort_order: 20,
        },
        {
          field_key: "message",
          field_type: "textarea",
          label: "Enquiry details",
          placeholder:
            "Describe what you need without including passwords or confidential financial information.",
          help_text:
            "A staff member will use this information to route the enquiry.",
          is_required: true,
          validation: { max_length: 2000 },
          sort_order: 30,
        },
        {
          field_key: "preferred_contact_method",
          field_type: "radio",
          label: "Preferred contact method",
          is_required: false,
          options: ["Phone", "Email", "Either"],
          sort_order: 40,
        },
      ],
      change_summary: "Create the initial governed public contact form",
    },
  ]),
  navigation: Object.freeze([
    {
      navigation_key: "header_home",
      navigation_location: "header",
      label: "Home",
      url: "/website",
      sort_order: 10,
      opens_new_tab: false,
    },
    {
      navigation_key: "header_about",
      navigation_location: "header",
      label: "About",
      page_key: "about",
      sort_order: 20,
      opens_new_tab: false,
    },
    {
      navigation_key: "header_divisions",
      navigation_location: "header",
      label: "Divisions",
      url: "/divisions",
      sort_order: 30,
      opens_new_tab: false,
    },
    {
      navigation_key: "header_projects",
      navigation_location: "header",
      label: "Projects",
      url: "/projects",
      sort_order: 40,
      opens_new_tab: false,
    },
    {
      navigation_key: "header_equipment",
      navigation_location: "header",
      label: "Equipment",
      url: "/equipment",
      sort_order: 50,
      opens_new_tab: false,
    },
    {
      navigation_key: "header_news",
      navigation_location: "header",
      label: "News",
      url: "/news",
      sort_order: 60,
      opens_new_tab: false,
    },
    {
      navigation_key: "header_contact",
      navigation_location: "header",
      label: "Contact",
      page_key: "contact",
      sort_order: 70,
      opens_new_tab: false,
    },
    {
      navigation_key: "footer_about",
      navigation_location: "footer",
      label: "About",
      page_key: "about",
      sort_order: 10,
      opens_new_tab: false,
    },
    {
      navigation_key: "footer_faqs",
      navigation_location: "footer",
      label: "FAQs",
      url: "/faqs",
      sort_order: 20,
      opens_new_tab: false,
    },
    {
      navigation_key: "footer_locations",
      navigation_location: "footer",
      label: "Locations",
      url: "/locations",
      sort_order: 30,
      opens_new_tab: false,
    },
    {
      navigation_key: "footer_careers",
      navigation_location: "footer",
      label: "Careers",
      url: "/vacancies",
      sort_order: 40,
      opens_new_tab: false,
    },
    {
      navigation_key: "footer_tenders",
      navigation_location: "footer",
      label: "Tenders",
      url: "/tenders",
      sort_order: 50,
      opens_new_tab: false,
    },
    {
      navigation_key: "footer_contact",
      navigation_location: "footer",
      label: "Contact",
      page_key: "contact",
      sort_order: 60,
      opens_new_tab: false,
    },
  ]),
});

const COMPANY_TABLES = Object.freeze({
  division: Object.freeze({
    table: "public_business_divisions",
    column: "division_key",
  }),
  statistic: Object.freeze({
    table: "public_company_statistics",
    column: "statistic_key",
  }),
  faq: Object.freeze({
    table: "public_faqs",
    column: "faq_key",
  }),
});

function actor(id, role) {
  return Object.freeze({
    id: Number(id),
    full_name: `CHALIN ONE Staging ${role}`,
  });
}

async function existingId(table, column, value) {
  const allowed = new Set([
    "public_pages.page_key",
    "public_forms.form_key",
    "public_navigation_items.navigation_key",
    "public_site_settings.setting_key",
    "public_business_divisions.division_key",
    "public_company_statistics.statistic_key",
    "public_faqs.faq_key",
  ]);
  if (!allowed.has(`${table}.${column}`)) {
    throw new Error("Unsafe staging seed lookup.");
  }
  const [rows] = await pool.query(
    `SELECT id FROM ${table} WHERE ${column} = ? LIMIT 1`,
    [value]
  );
  return Number(rows[0]?.id || 0) || null;
}

async function assertMigrationReady() {
  const [rows] = await pool.query(
    `SELECT migration_name
     FROM schema_migrations
     WHERE migration_name = ?
     LIMIT 1`,
    [MIGRATION_RECORD]
  );
  if (!rows[0]) {
    const error = new Error(
      "Run and verify the CHALIN ONE public-content migration before seeding staging content."
    );
    error.code = "CHALIN_ONE_STAGING_SCHEMA_NOT_READY";
    throw error;
  }
}

async function assertUsersExist(users) {
  const ids = [users.author, users.reviewer, users.publisher];
  const [rows] = await pool.query(
    "SELECT id FROM users WHERE id IN (?, ?, ?)",
    ids
  );
  const found = new Set(rows.map((row) => Number(row.id)));
  const missing = ids.filter((id) => !found.has(Number(id)));
  if (missing.length > 0) {
    const error = new Error(
      `Staging author, reviewer and publisher users must already exist. Missing IDs: ${missing.join(", ")}.`
    );
    error.code = "CHALIN_ONE_STAGING_USERS_NOT_FOUND";
    throw error;
  }
}

function validateManifest() {
  const identities = new Set();
  for (const page of STAGING_SEED_MANIFEST.pages) {
    if (!normalizePageKey(page.page_key) || !normalizeSlug(page.slug)) {
      throw new Error(`Invalid staging page identity: ${page.page_key}`);
    }
    sanitizeVersionInput(page, { requireTitle: true });
    const identity = `page:${page.page_key}`;
    if (identities.has(identity)) throw new Error(`Duplicate ${identity}`);
    identities.add(identity);
  }

  for (const division of STAGING_SEED_MANIFEST.divisions) {
    sanitizeSnapshot("division", division);
    identities.add(`division:${division.division_key}`);
  }
  for (const statistic of STAGING_SEED_MANIFEST.statistics) {
    sanitizeSnapshot("statistic", statistic);
    identities.add(`statistic:${statistic.statistic_key}`);
  }
  for (const faq of STAGING_SEED_MANIFEST.faqs) {
    sanitizeSnapshot("faq", faq);
    identities.add(`faq:${faq.faq_key}`);
  }
  for (const form of STAGING_SEED_MANIFEST.forms) {
    sanitizeFormSnapshot(form);
    identities.add(`form:${form.form_key}`);
  }
  for (const item of STAGING_SEED_MANIFEST.navigation) {
    sanitizeNavigationSnapshot({
      ...item,
      page_id: item.page_key ? 1 : null,
    });
    identities.add(`navigation:${item.navigation_key}`);
  }
  for (const setting of STAGING_SEED_MANIFEST.settings) {
    const key = normalizeSettingKey(setting.setting_key);
    if (!key) throw new Error(`Invalid staging setting: ${setting.setting_key}`);
    assertPublicSettingAllowed(key, setting.is_public === true);
    identities.add(`setting:${key}`);
  }

  const expected =
    STAGING_SEED_MANIFEST.pages.length +
    STAGING_SEED_MANIFEST.divisions.length +
    STAGING_SEED_MANIFEST.statistics.length +
    STAGING_SEED_MANIFEST.faqs.length +
    STAGING_SEED_MANIFEST.forms.length +
    STAGING_SEED_MANIFEST.navigation.length +
    STAGING_SEED_MANIFEST.settings.length;
  if (identities.size !== expected) {
    throw new Error("The staging seed manifest contains duplicate identities.");
  }

  return Object.freeze({
    pages: STAGING_SEED_MANIFEST.pages.length,
    divisions: STAGING_SEED_MANIFEST.divisions.length,
    statistics: STAGING_SEED_MANIFEST.statistics.length,
    faqs: STAGING_SEED_MANIFEST.faqs.length,
    forms: STAGING_SEED_MANIFEST.forms.length,
    navigation: STAGING_SEED_MANIFEST.navigation.length,
    settings: STAGING_SEED_MANIFEST.settings.length,
    total: expected,
  });
}

function resultBucket() {
  return { created: [], skipped: [] };
}

async function seedSettings(authorUser, results) {
  for (const input of STAGING_SEED_MANIFEST.settings) {
    const id = await existingId(
      "public_site_settings",
      "setting_key",
      input.setting_key
    );
    if (id) {
      results.skipped.push(`setting:${input.setting_key}`);
      continue;
    }
    await upsertSiteSetting({ input, user: authorUser, req: REQUEST });
    results.created.push(`setting:${input.setting_key}`);
  }
}

async function seedPages(authorUser, results) {
  const pageIds = new Map();
  for (const input of STAGING_SEED_MANIFEST.pages) {
    let id = await existingId("public_pages", "page_key", input.page_key);
    if (id) {
      results.skipped.push(`page:${input.page_key}`);
    } else {
      const details = await createPageDraft({
        input,
        user: authorUser,
        req: REQUEST,
      });
      id = Number(details?.page?.id);
      results.created.push(`page:${input.page_key}`);
    }
    pageIds.set(input.page_key, id);
  }
  return pageIds;
}

async function seedCompanyInfo(kind, items, authorUser, results) {
  const config = COMPANY_TABLES[kind];
  for (const input of items) {
    const key = input[config.column];
    const id = await existingId(config.table, config.column, key);
    if (id) {
      results.skipped.push(`${kind}:${key}`);
      continue;
    }
    await createEntityDraft({ kind, input, user: authorUser, req: REQUEST });
    results.created.push(`${kind}:${key}`);
  }
}

async function seedForms(authorUser, results) {
  for (const input of STAGING_SEED_MANIFEST.forms) {
    const id = await existingId("public_forms", "form_key", input.form_key);
    if (id) {
      results.skipped.push(`form:${input.form_key}`);
      continue;
    }
    await createFormDraft({ input, user: authorUser, req: REQUEST });
    results.created.push(`form:${input.form_key}`);
  }
}

async function seedNavigation(pageIds, authorUser, results) {
  for (const item of STAGING_SEED_MANIFEST.navigation) {
    const id = await existingId(
      "public_navigation_items",
      "navigation_key",
      item.navigation_key
    );
    if (id) {
      results.skipped.push(`navigation:${item.navigation_key}`);
      continue;
    }
    const input = {
      ...item,
      page_id: item.page_key ? pageIds.get(item.page_key) : null,
      change_summary: `Create ${item.label} staging navigation draft`,
    };
    delete input.page_key;
    await createNavigationDraft({ input, user: authorUser, req: REQUEST });
    results.created.push(`navigation:${item.navigation_key}`);
  }
}

async function runStagingSeed({ dryRun = false, env = process.env } = {}) {
  const staging = validateStagingEnvironment(env, { mode: "seed" });
  const manifest = validateManifest();
  if (dryRun) {
    return Object.freeze({
      dry_run: true,
      staging,
      manifest,
      message:
        "Manifest validated. No database connection or content write was performed.",
    });
  }

  await assertMigrationReady();
  await assertUsersExist(staging.users);
  const authorUser = actor(staging.users.author, "Author");
  const results = resultBucket();

  await seedSettings(authorUser, results);
  const pageIds = await seedPages(authorUser, results);
  await seedCompanyInfo(
    "division",
    STAGING_SEED_MANIFEST.divisions,
    authorUser,
    results
  );
  await seedCompanyInfo(
    "statistic",
    STAGING_SEED_MANIFEST.statistics,
    authorUser,
    results
  );
  await seedCompanyInfo(
    "faq",
    STAGING_SEED_MANIFEST.faqs,
    authorUser,
    results
  );
  await seedForms(authorUser, results);
  await seedNavigation(pageIds, authorUser, results);

  return Object.freeze({
    dry_run: false,
    staging,
    manifest,
    created: results.created,
    skipped: results.skipped,
    next_steps: [
      "Open Content Studio as the staging author and inspect every draft.",
      `Submit exact versions to reviewer user ${staging.users.reviewer}.`,
      "Approve only verified wording, facts, media and contact information.",
      `Publish approved versions using publisher user ${staging.users.publisher}.`,
      "Do not publish placeholder addresses, leadership, testimonials, vacancies or tenders until verified source information is supplied.",
    ],
  });
}

if (require.main === module) {
  const dryRun = process.argv.includes("--dry-run");
  runStagingSeed({ dryRun })
    .then((result) => {
      console.log(
        dryRun
          ? "CHALIN ONE staging seed manifest verified."
          : "CHALIN ONE staging drafts prepared safely."
      );
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(`CHALIN ONE staging seed failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (!dryRun) await pool.end().catch(() => {});
    });
}

module.exports = {
  COMPANY_TABLES,
  MIGRATION_RECORD,
  REQUEST,
  STAGING_SEED_MANIFEST,
  actor,
  assertMigrationReady,
  assertUsersExist,
  existingId,
  runStagingSeed,
  validateManifest,
};