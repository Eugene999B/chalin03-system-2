"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { pool } = require("../config/db");
const {
  MAX_SITEMAP_URLS,
  getPublicSeoInventory,
} = require("../services/publicSeoDeliveryService");

const FORBIDDEN_PREFIXES = [
  "/api",
  "/login",
  "/staff",
  "/content-studio",
  "/intelligence",
  "/mining-operations",
  "/equipment-hire-operations",
  "/equipment-installment-finance",
  "/group-executive-control",
  "/forms/",
];

test("published SEO inventory executes against the migrated acceptance schema", async () => {
  const inventory = await getPublicSeoInventory();
  assert.ok(inventory);
  assert.equal(Array.isArray(inventory.items), true);
  assert.equal(inventory.total, inventory.items.length);
  assert.ok(inventory.total <= MAX_SITEMAP_URLS);
  assert.equal(inventory.policy.published_only, true);
  assert.equal(inventory.policy.governed_page_sitemap_flag_required, true);
  assert.equal(inventory.policy.governed_page_noindex_excluded, true);
  assert.equal(inventory.policy.private_forms_excluded, true);

  const paths = inventory.items.map((item) => item.path);
  assert.equal(new Set(paths).size, paths.length);
  for (const pathname of paths) {
    assert.match(pathname, /^\/(?!\/)/);
    for (const prefix of FORBIDDEN_PREFIXES) {
      assert.equal(
        pathname === prefix || pathname.startsWith(prefix),
        false,
        `${pathname} must not expose ${prefix}`
      );
    }
  }
});

test.after(async () => {
  await pool.end();
});
