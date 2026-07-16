const assert = require("node:assert/strict");
const {
  readFileSync,
} = require("node:fs");
const {
  join,
} = require("node:path");
const test = require("node:test");

const backendRoot = join(__dirname, "..");
const projectRoot = join(backendRoot, "..");

function readBackend(relativePath) {
  return readFileSync(
    join(backendRoot, relativePath),
    "utf8"
  );
}

function readProject(relativePath) {
  return readFileSync(
    join(projectRoot, relativePath),
    "utf8"
  );
}

test(
  "worker expansion migration is additive and complete",
  () => {
    const source = readProject(
      "database/migrations/20260716_release2d_worker_profile_expansion.sql"
    );

    for (const marker of [
      "preferred_name",
      "date_of_birth",
      "national_id_number",
      "ssnit_number",
      "worker_family_members",
      "worker_emergency_contacts",
      "worker_private_files",
      "worker_profile_change_history",
      "MEDIUMBLOB",
      "release2d_worker_profile_expansion",
    ]) {
      assert.match(source, new RegExp(marker));
    }

    assert.doesNotMatch(
      source,
      /\bTRUNCATE\b/i
    );

    assert.doesNotMatch(
      source,
      /\bDELETE\s+FROM\s+(sales|products|customers|debts|expenses|purchases)\b/i
    );
  }
);

test(
  "worker routes provide private photo, document and family controls",
  () => {
    const source = readBackend(
      "routes/workerProfileExpansionRoutes.js"
    );

    for (const marker of [
      "MAX_PHOTO_BYTES",
      "MAX_DOCUMENT_BYTES",
      "workers.sensitive.view",
      "workers.documents.view",
      "workers-expanded/:id/photo",
      "workers-expanded/:id/family",
      "workers-expanded/:id/emergency-contacts",
      "workers-expanded/:id/files",
      "checksum_sha256",
      "Cache-Control",
      "private, no-store",
      "worker_profile_change_history",
    ]) {
      assert.match(source, new RegExp(marker));
    }

    assert.match(
      source,
      /image\/jpeg/
    );

    assert.match(
      source,
      /application\/pdf/
    );

    assert.doesNotMatch(
      source,
      /public\/uploads/
    );
  }
);

test(
  "expanded worker routes are registered",
  () => {
    const server = readBackend("server.js");
    const permissions = readBackend(
      "security/permissionCatalog.js"
    );

    assert.match(
      server,
      /workerProfileExpansionRoutes/
    );

    assert.match(
      permissions,
      /workers\.sensitive\.view/
    );

    assert.match(
      permissions,
      /workers\.documents\.view/
    );
  }
);

test(
  "professional backup supports private binary worker files safely",
  () => {
    const source = readBackend(
      "routes/release2FinalRoutes.js"
    );

    assert.match(
      source,
      /worker_private_files/
    );

    assert.match(
      source,
      /backupSafeValue/
    );

    assert.match(
      source,
      /encoding:\s*"base64"/
    );
  }
);