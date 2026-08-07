import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveApiBaseUrl,
} from "../src/api/apiBaseUrl.js";
import {
  onRequest,
  upstreamHeadersFor,
  upstreamUrlFor,
} from "../functions/api/[[path]].js";

const currentFile = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(currentFile), "..");
const read = (...parts) => fs.readFileSync(path.join(frontendRoot, ...parts), "utf8");

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
    },
  })
);
assert.equal(requestHeaders.get("authorization"), "Bearer live-token");
assert.equal(requestHeaders.get("origin"), "https://chalin03.com");
assert.equal(requestHeaders.get("x-chalin03-workspace"), "equipment_hire");
assert.equal(requestHeaders.get("x-chalin03-division"), "installment_finance");
assert.equal(requestHeaders.get("host"), null);
assert.equal(
  requestHeaders.get("x-chalin03-same-origin-proxy"),
  "cloudflare-pages"
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
  assert.equal(response.headers.get("x-chalin03-api-path"), "same-origin-pages-proxy");
  assert.deepEqual(await response.json(), { status: "success", user: { id: 1 } });
} finally {
  globalThis.fetch = originalFetch;
}

const axiosClient = read("src", "api", "axiosClient.js");
const serviceWorker = read("public", "sw.js");
const headersFile = read("public", "_headers");

assert.match(axiosClient, /import \{ API_BASE_URL \} from "\.\/apiBaseUrl"/);
assert.match(axiosClient, /baseURL: API_BASE_URL/);
assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api"\)/);
assert.match(headersFile, /connect-src 'self'/);

console.log("Same-origin Chalin 03 production API proxy contracts passed.");
