"use strict";

const { pool } = require("../config/db");
const {
  createNavigationDraft,
  sanitizeNavigationSnapshot,
} = require("../services/contentStudioNavigationService");
const {
  validateStagingEnvironment,
} = require("./verifyChalinOneStagingEnvironment");

const MIGRATION_RECORD = "20260805_chalin_one_public_content_foundation";
const REQUEST = Object.freeze({
  requestId: "chalin-one-staging-navigation-hierarchy-seed",
  headers: {},
});

const STAGING_NAVIGATION_HIERARCHY = Object.freeze([
  Object.freeze({
    navigation_key: "header_division_spare_parts",
    parent_key: "header_divisions",
    navigation_location: "header",
    label: "Spare Parts",
    url: "/divisions/spare-parts",
    sort_order: 10,
    opens_new_tab: false,
  }),
  Object.freeze({
    navigation_key: "header_division_mining",
    parent_key: "header_divisions",
    navigation_location: "header",
    label: "Mining Operations",
    url: "/divisions/mining-operations",
    sort_order: 20,
    opens_new_tab: false,
  }),
  Object.freeze({
    navigation_key: "header_division_hire",
    parent_key: "header_divisions",
    navigation_location: "header",
    label: "Equipment Hire",
    url: "/divisions/equipment-hire",
    sort_order: 30,
    opens_new_tab: false,
  }),
  Object.freeze({
    navigation_key: "header_division_sales",
    parent_key: "header_divisions",
    navigation_location: "header",
    label: "Equipment Sales",
    url: "/divisions/equipment-sales",
    sort_order: 40,
    opens_new_tab: false,
  }),
  Object.freeze({
    navigation_key: "header_division_finance",
    parent_key: "header_divisions",
    navigation_location: "header",
    label: "Installment Finance",
    url: "/divisions/installment-finance",
    sort_order: 50,
    opens_new_tab: false,
  }),
  Object.freeze({
    navigation_key: "footer_company_leadership",
    parent_key: "footer_about",
    navigation_location: "footer",
    label: "Leadership",
    url: "/leadership",
    sort_order: 10,
    opens_new_tab: false,
  }),
  Object.freeze({
    navigation_key: "footer_company_news",
    parent_key: "footer_about",
    navigation_location: "footer",
    label: "Newsroom",
    url: "/news",
    sort_order: 20,
    opens_new_tab: false,
  }),
]);

function validateHierarchyManifest() {
  const keys = new Set();
  for (const item of STAGING_NAVIGATION_HIERARCHY) {
    if (!item.parent_key || keys.has(item.navigation_key)) {
      throw new Error(
        `Invalid or duplicate staging navigation child: ${item.navigation_key}`
      );
    }
    sanitizeNavigationSnapshot({ ...item, parent_id: 1 });
    keys.add(item.navigation_key);
  }
  return Object.freeze({
    navigation_children: STAGING_NAVIGATION_HIERARCHY.length,
    header_children: STAGING_NAVIGATION_HIERARCHY.filter(
      (item) => item.navigation_location === "header"
    ).length,
    footer_children: STAGING_NAVIGATION_HIERARCHY.filter(
      (item) => item.navigation_location === "footer"
    ).length,
  });
}

async function navigationItemId(navigationKey) {
  const [rows] = await pool.query(
    `SELECT id
       FROM public_navigation_items
      WHERE navigation_key = ?
      LIMIT 1`,
    [navigationKey]
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
      "Run and verify the CHALIN ONE public-content migration before seeding navigation hierarchy drafts."
    );
    error.code = "CHALIN_ONE_STAGING_SCHEMA_NOT_READY";
    throw error;
  }
}

async function assertAuthorExists(authorId) {
  const [rows] = await pool.query(
    "SELECT id FROM users WHERE id = ? LIMIT 1",
    [authorId]
  );
  if (!rows[0]) {
    const error = new Error(
      `The staging author user ${authorId} must exist before hierarchy seeding.`
    );
    error.code = "CHALIN_ONE_STAGING_AUTHOR_NOT_FOUND";
    throw error;
  }
}

async function runStagingNavigationHierarchySeed({
  dryRun = false,
  env = process.env,
} = {}) {
  const staging = validateStagingEnvironment(env, { mode: "seed" });
  const manifest = validateHierarchyManifest();
  if (dryRun) {
    return Object.freeze({
      dry_run: true,
      staging,
      manifest,
      message:
        "Navigation hierarchy manifest validated. No database connection or content write was performed.",
    });
  }

  await assertMigrationReady();
  await assertAuthorExists(staging.users.author);
  const author = Object.freeze({
    id: staging.users.author,
    full_name: "CHALIN ONE Staging Author",
  });
  const created = [];
  const skipped = [];

  for (const item of STAGING_NAVIGATION_HIERARCHY) {
    const existing = await navigationItemId(item.navigation_key);
    if (existing) {
      skipped.push(`navigation:${item.navigation_key}`);
      continue;
    }

    const parentId = await navigationItemId(item.parent_key);
    if (!parentId) {
      const error = new Error(
        `Run the core staging seed first. Parent navigation item ${item.parent_key} is missing.`
      );
      error.code = "CHALIN_ONE_STAGING_NAVIGATION_PARENT_MISSING";
      throw error;
    }

    const input = {
      ...item,
      parent_id: parentId,
      change_summary: `Create ${item.label} staging child navigation draft`,
    };
    delete input.parent_key;
    await createNavigationDraft({ input, user: author, req: REQUEST });
    created.push(`navigation:${item.navigation_key}`);
  }

  return Object.freeze({
    dry_run: false,
    staging,
    manifest,
    created,
    skipped,
    next_steps: [
      "Review the parent and child navigation drafts together in Content Studio.",
      "Submit each exact child version to the independent staging reviewer.",
      "Publish the children only after their linked division and destination pages are verified.",
    ],
  });
}

function isDryRun(argv = process.argv.slice(2)) {
  return argv.includes("--dry-run");
}

if (require.main === module) {
  runStagingNavigationHierarchySeed({ dryRun: isDryRun() })
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
    })
    .catch((error) => {
      console.error(
        `CHALIN ONE staging navigation hierarchy seed failed: ${error.message}`
      );
      process.exitCode = 1;
    });
}

module.exports = {
  MIGRATION_RECORD,
  REQUEST,
  STAGING_NAVIGATION_HIERARCHY,
  assertAuthorExists,
  assertMigrationReady,
  isDryRun,
  navigationItemId,
  runStagingNavigationHierarchySeed,
  validateHierarchyManifest,
};
