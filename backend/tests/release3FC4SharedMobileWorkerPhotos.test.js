const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("Release 3F-C4 Shared Reports and Audit tables become readable mobile cards", () => {
  const page = read("frontend/src/pages/SharedReportsDocumentsPage.jsx");
  const css = read("frontend/src/styles/sharedReportsDocuments.css");

  assert.match(page, /data-label="Customer \/ Site"/);
  assert.match(page, /data-label="Document \/ Format"/);
  assert.match(page, /data-label="Request ID"/);
  assert.match(css, /Release 3F-C4 mobile-first Shared Reports, Documents & Audit Centre/);
  assert.match(css, /content: attr\(data-label\)/);
  assert.match(css, /\.srd-table thead[\s\S]*position: absolute/);
  assert.match(css, /\.srd-action-row button[\s\S]*width: 100%/);
});

test("Release 3F-C4 worker photograph retrieval is category-isolated and uses valid SQL aliases", () => {
  const routes = read("backend/routes/workerProfileExpansionRoutes.js");

  assert.match(routes, /FROM worker_private_files file/);
  assert.match(routes, /INNER JOIN worker_profiles worker/);
  assert.match(routes, /worker\.workspace_code = \?/);
  assert.match(routes, /file\.is_current = TRUE/);
  assert.match(routes, /\[workerId, activeWorkerWorkspace\(req\)\]/);
  assert.doesNotMatch(
    routes,
    /FROM worker_private_files\s+WHERE worker_id = \?[\s\S]{0,180}AND file\.is_current/
  );
});

test("Release 3F-C4 optimizes phone photographs before secure upload", () => {
  const page = read("frontend/src/pages/ExpandedWorkerProfilePage.jsx");

  assert.match(page, /async function optimizeWorkerPhoto/);
  assert.match(page, /const maximumDimension = 1200/);
  assert.match(page, /15 \* 1024 \* 1024/);
  assert.match(page, /2 \* 1024 \* 1024/);
  assert.match(page, /imageOrientation: "from-image"/);
  assert.match(page, /file_name: optimized\.fileName/);
  assert.match(page, /mime_type: optimized\.mimeType/);
  assert.match(page, /data_base64: optimized\.dataUrl/);
});

test("Release 3F-C4 shows worker faces in the worker list before profile selection", () => {
  const page = read("frontend/src/pages/ExpandedWorkerProfilePage.jsx");
  const css = read("frontend/src/styles/expandedWorkerProfile.css");

  assert.match(page, /const \[workerPhotoUrls, setWorkerPhotoUrls\]/);
  assert.match(page, /async function loadWorkerThumbnails/);
  assert.match(page, /workerPhotoUrls\[String\(worker\.id\)\]/);
  assert.match(page, /alt={`\$\{worker\.full_name\} profile`}/);
  assert.match(css, /Release 3F-C4 worker photo upload and list thumbnail correction/);
  assert.match(css, /\.worker-list-avatar img/);
  assert.match(css, /object-fit: cover/);
});
