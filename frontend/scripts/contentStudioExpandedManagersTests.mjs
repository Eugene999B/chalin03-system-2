import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(frontendRoot, "src/chalin-one/content-studio");
const governed = fs.readFileSync(path.join(root, "ContentStudioGovernedManager.jsx"), "utf8");
const portfolio = fs.readFileSync(path.join(root, "ContentStudioPortfolioManagers.jsx"), "utf8");
const portfolioApi = fs.readFileSync(path.join(root, "contentStudioPortfolioApi.js"), "utf8");
const company = fs.readFileSync(path.join(root, "ContentStudioCompanyInfoManager.jsx"), "utf8");
const companyApi = fs.readFileSync(path.join(root, "contentStudioCompanyInfoApi.js"), "utf8");
const workspace = fs.readFileSync(path.join(root, "ContentStudioWorkspace.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "contentStudioExpandedManagers.css"), "utf8");

let passed = 0;
function check(name, callback) {
  callback();
  passed += 1;
  console.log(`✓ ${name}`);
}

check("shared governed manager controls every mutation by exact permission", () => {
  for (const permission of ["create", "edit", "submit", "approve", "publish", "restore", "archive"]) {
    assert.match(governed, new RegExp(`CONTENT_STUDIO_PERMISSIONS\\.${permission}`));
  }
  assert.match(governed, /content_version_id/);
  assert.match(governed, /pendingApproval/);
  assert.match(governed, /approvedApproval/);
  assert.match(governed, /selectedVersion\?\.version_status === "draft"/);
  assert.match(governed, /window\.confirm/);
});

check("shared manager cancels stale requests and never handles tokens or raw HTML", () => {
  assert.match(governed, /new AbortController\(\)/);
  assert.match(governed, /controller\.abort\(\)/);
  assert.doesNotMatch(governed, /localStorage|sessionStorage|Bearer|dangerouslySetInnerHTML|contentEditable|eval\(/);
});

check("portfolio API limits kinds and maps the complete governed lifecycle", () => {
  assert.match(portfolioApi, /\["leadership", "project", "equipment"\]/);
  for (const fragment of ["/versions", "/submit", "/approvals/", "/decision", "/publish", "/restore", "/archive"]) {
    assert.match(portfolioApi, new RegExp(fragment.replaceAll("/", "\\/")));
  }
  assert.doesNotMatch(portfolioApi, /axiosClient\.delete|fetch\(|Bearer/);
});

check("Projects include the complete backend project contract", () => {
  for (const field of [
    "project_key", "slug", "division_id", "title", "summary", "body_text",
    "location_text", "operational_status", "start_date", "end_date",
    "featured_media_asset_id", "gallery", "sort_order",
  ]) assert.match(portfolio, new RegExp(field));
  for (const status of ["planned", "active", "paused", "completed", "cancelled"]) {
    assert.match(portfolio, new RegExp(`"${status}"`));
  }
  for (const role of ["hero", "gallery", "site", "before", "after", "video"]) {
    assert.match(portfolio, new RegExp(`"${role}"`));
  }
  assert.match(portfolio, /current\.gallery\.length >= 60/);
  assert.match(portfolio, /has_structured_body/);
});

check("Equipment includes references, availability, pricing and public offers", () => {
  for (const field of [
    "equipment_key", "internal_reference_type", "internal_reference_id", "manufacturer",
    "model_year", "equipment_category", "condition_label", "availability_status",
    "specification_rows", "features_text", "currency_code", "display_price",
    "show_price", "hire_available", "finance_available", "featured_media_asset_id",
  ]) assert.match(portfolio, new RegExp(field));
  for (const type of ["fleet_asset", "equipment_catalogue", "installment_equipment", "external"]) {
    assert.match(portfolio, new RegExp(`"${type}"`));
  }
  for (const status of ["available", "reserved", "hired", "sold", "maintenance", "unavailable", "coming_soon"]) {
    assert.match(portfolio, new RegExp(`"${status}"`));
  }
  assert.match(portfolio, /has_advanced_specifications/);
  assert.match(portfolio, /form\.internal_reference_type === "external"/);
});

check("Company Information API supports exactly all seven governed kinds", () => {
  for (const kind of ["division", "location", "statistic", "testimonial", "faq", "vacancy", "tender"]) {
    assert.match(companyApi, new RegExp(`"${kind}"`));
  }
  assert.match(companyApi, /Unsupported Content Studio company-information manager/);
  assert.doesNotMatch(companyApi, /axiosClient\.delete|fetch\(|Bearer/);
});

check("Company Information exposes all seven visual manager tabs", () => {
  for (const label of ["Divisions", "Locations", "Statistics", "Testimonials", "FAQs", "Vacancies", "Tenders"]) {
    assert.match(company, new RegExp(`"${label}"`));
  }
  assert.match(company, /role="tablist"/);
  assert.match(company, /aria-selected/);
  assert.match(company, /key=\{activeKind\}/);
});

check("Company Information fields match backend schema contracts", () => {
  for (const field of [
    "division_key", "contact_phone", "contact_email", "location_key", "latitude", "longitude",
    "business_hours", "statistic_key", "display_value", "numeric_value", "as_of_date",
    "testimonial_key", "customer_display_name", "quote_text", "rating", "faq_key",
    "question", "answer", "vacancy_key", "location_id", "application_url",
    "vacancies_count", "opens_at", "closes_at", "tender_key", "reference_number",
    "submission_instructions", "document_media_asset_id",
  ]) assert.match(company, new RegExp(field));
  assert.match(company, /dateTimeForSave/);
  assert.match(company, /structuredForSave/);
});

check("workspace connects the complete expanded company batch", () => {
  assert.match(workspace, /ContentStudioProjectManager/);
  assert.match(workspace, /ContentStudioEquipmentManager/);
  assert.match(workspace, /ContentStudioCompanyInfoManager/);
  assert.match(workspace, /activeKey === "projects"/);
  assert.match(workspace, /activeKey === "equipment"/);
  assert.match(workspace, /activeKey === "company-info"/);
});

check("expanded layouts cover desktop, tablet and mobile", () => {
  assert.match(css, /cs-manager-tabs/);
  assert.match(css, /grid-template-columns: repeat\(3/);
  assert.match(css, /@media \(max-width: 980px\)/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /@media \(max-width: 430px\)/);
});

console.log(`\nExpanded Content Studio managers: ${passed}/10 checks passed.`);
