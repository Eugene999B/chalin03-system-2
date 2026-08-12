import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHALIN_ONE_STAGING_API_URL,
  resolveApiBaseUrl,
} from "../src/api/apiBaseUrl.js";
import {
  classifyFetchFailure,
  onRequest,
  upstreamHeadersFor,
  upstreamUrlFor,
} from "../functions/api/[[path]].js";

const currentFile = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(currentFile), "..");
const repositoryRoot = path.resolve(frontendRoot, "..");
const read = (...parts) => fs.readFileSync(path.join(frontendRoot, ...parts), "utf8");
const readRoot = (...parts) => fs.readFileSync(path.join(repositoryRoot, ...parts), "utf8");

assert.equal(
  resolveApiBaseUrl({
    hostname: "chalin03.com",
    configured: "https://api.chalin03.com/api",
  }),
  "/api"
);
assert.equal(
  resolveApiBaseUrl({
    hostname: "www.chalin03.com",
    configured: "https://api.chalin03.com/api",
  }),
  "/api"
);
assert.equal(
  resolveApiBaseUrl({
    hostname: "chalin-one-staging-preview.pages.dev",
    configured: "https://api.chalin03.com/api",
  }),
  CHALIN_ONE_STAGING_API_URL
);
assert.equal(
  resolveApiBaseUrl({
    hostname: "chalin-one.chalin03-system-2.pages.dev",
    configured: "https://api.chalin03.com/api",
  }),
  CHALIN_ONE_STAGING_API_URL
);
assert.equal(
  resolveApiBaseUrl({
    hostname: "abc123.chalin-one-staging-preview.pages.dev",
    configured: "https://api.chalin03.com/api",
  }),
  CHALIN_ONE_STAGING_API_URL
);
assert.equal(
  resolveApiBaseUrl({
    hostname: "localhost",
    configured: "http://localhost:5000/api/",
  }),
  "http://localhost:5000/api"
);
assert.equal(
  resolveApiBaseUrl({
    hostname: "preview.pages.dev",
    configured: "https://api.chalin03.com/api",
  }),
  "https://api.chalin03.com/api"
);

const target = upstreamUrlFor(
  "https://chalin03.com/api/equipment-catalogue/sales/professional/completion-documents/options?format=pdf"
);
assert.equal(target.origin, "https://api.chalin03.com");
assert.equal(
  `${target.pathname}${target.search}`,
  "/api/equipment-catalogue/sales/professional/completion-documents/options?format=pdf"
);

const requestHeaders = upstreamHeadersFor(
  new Request("https://chalin03.com/api/auth/me", {
    headers: {
      Authorization: "Bearer live-token",
      Origin: "https://chalin03.com",
      "X-Chalin03-Workspace": "equipment_hire",
      "X-Chalin03-Division": "installment_finance",
      Host: "chalin03.com",
      "CF-EW-Via": "15",
      "CDN-Loop": "cloudflare; loops=1",
      "CF-Ray": "test-ray",
      "X-Forwarded-For": "203.0.113.10",
    },
  })
);
assert.equal(requestHeaders.get("authorization"), "Bearer live-token");
assert.equal(requestHeaders.get("origin"), "https://chalin03.com");
assert.equal(requestHeaders.get("x-chalin03-workspace"), "equipment_hire");
assert.equal(requestHeaders.get("x-chalin03-division"), "installment_finance");
assert.equal(requestHeaders.get("host"), null);
assert.equal(requestHeaders.get("cf-ew-via"), null);
assert.equal(requestHeaders.get("cdn-loop"), null);
assert.equal(requestHeaders.get("cf-ray"), null);
assert.equal(requestHeaders.get("x-forwarded-for"), null);
assert.equal(
  requestHeaders.get("x-chalin03-same-origin-proxy"),
  "cloudflare-pages-v2"
);

assert.equal(
  classifyFetchFailure(new Error("1042 Worker tried to fetch from another Worker")),
  "same-zone-worker-route"
);
assert.equal(
  classifyFetchFailure(new Error("1019 loop limit reached")),
  "worker-loop-protection"
);

const originalFetch = globalThis.fetch;
let capturedRequest = null;
globalThis.fetch = async (url, init) => {
  capturedRequest = { url: String(url), init };
  return new Response(JSON.stringify({ status: "success", user: { id: 1 } }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "https://chalin03.com",
    },
  });
};

try {
  const response = await onRequest({
    request: new Request("https://chalin03.com/api/auth/me", {
      method: "GET",
      headers: {
        Authorization: "Bearer live-token",
        "X-Chalin03-Workspace": "equipment_hire",
        "X-Chalin03-Division": "installment_finance",
      },
    }),
  });

  assert.equal(capturedRequest.url, "https://api.chalin03.com/api/auth/me");
  assert.equal(capturedRequest.init.method, "GET");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("x-chalin03-api-path"), "same-origin-pages-proxy-v2");
  assert.deepEqual(await response.json(), { status: "success", user: { id: 1 } });
} finally {
  globalThis.fetch = originalFetch;
}

const axiosClient = read("src", "api", "axiosClient.js");
const viteConfig = read("vite.config.js");
const serviceWorker = read("public", "sw.js");
const headersFile = read("public", "_headers");
const mediaBridge = read("src", "utils", "equipmentMediaCaptureBridge.js");
const commandGate = read("src", "utils", "commandGate.js");
const frontendWrangler = read("wrangler.toml");
const rootWrangler = readRoot("wrangler.toml");

assert.match(axiosClient, /import \{ API_BASE_URL \} from "\.\/apiBaseUrl"/);
assert.match(axiosClient, /baseURL: API_BASE_URL/);
assert.match(viteConfig, /CF_PAGES/);
assert.match(viteConfig, /process\.env\.VITE_API_URL = "\/api"/);
assert.match(mediaBridge, /import\.meta\.env\.VITE_API_URL/);
assert.match(commandGate, /import\.meta\.env\.VITE_API_URL/);
assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api"\)/);
assert.match(headersFile, /connect-src 'self'/);
assert.match(frontendWrangler, /global_fetch_strictly_public/);
assert.match(frontendWrangler, /pages_build_output_dir = "\.\/dist"/);
assert.match(rootWrangler, /global_fetch_strictly_public/);
assert.match(rootWrangler, /pages_build_output_dir = "\.\/frontend\/dist"/);

console.log("Same-origin Chalin 03 production API proxy contracts passed.");
