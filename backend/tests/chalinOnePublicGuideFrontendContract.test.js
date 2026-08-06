"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../..");
function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const api = read("frontend/src/chalin-one/public-site/publicGuideApi.js");
const widget = read(
  "frontend/src/chalin-one/public-site/PublicGuideWidget.jsx"
);
const css = read("frontend/src/chalin-one/public-site/publicGuide.css");

test("public Guide client is anonymous and keeps session token in memory only", () => {
  assert.match(api, /axios\.create/);
  assert.match(api, /baseURL: "\/api\/public\/guide"/);
  assert.match(api, /withCredentials: false/);
  assert.match(api, /x-chalin-guide-session/);
  assert.doesNotMatch(api, /axiosClient|Authorization|Bearer/);
  assert.doesNotMatch(api, /localStorage|sessionStorage|document\.cookie/);
});

test("widget exposes public-only boundary and governed human handoff", () => {
  assert.match(widget, /Published public information only/);
  assert.match(widget, /cannot access private accounts/i);
  assert.match(widget, /submitGuideHandoff/);
  assert.match(widget, /consent_given/);
  assert.match(widget, /protected Enquiry Desk/);
  assert.match(widget, /reference_code/);
});

test("widget shows evidence and never renders raw HTML", () => {
  assert.match(widget, /Evidence/);
  assert.match(widget, /item\.citation/);
  assert.match(widget, /item\.excerpt_text/);
  assert.doesNotMatch(widget, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(widget, /\beval\s*\(|new Function|<iframe|<script/i);
});

test("widget requests only minimum public handoff contact fields", () => {
  assert.match(widget, /full_name/);
  assert.match(widget, /email/);
  assert.match(widget, /phone/);
  assert.match(widget, /service_interest/);
  assert.match(widget, /preferred_contact_method/);
  assert.doesNotMatch(
    widget,
    /ghana_card|passport_number|bank_account|payslip|password|customer_id|debt_id/i
  );
});

test("Guide UI remains responsive at public mobile widths", () => {
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /@media \(max-width: 390px\)/);
  assert.match(css, /\.pg-guide-panel/);
  assert.match(css, /\.pg-guide-composer/);
  assert.match(css, /\.pg-guide-handoff/);
});
