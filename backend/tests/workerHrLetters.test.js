const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const backendRoot = join(__dirname, "..");
const projectRoot = join(backendRoot, "..");

function readBackend(path) {
  return readFileSync(join(backendRoot, path), "utf8");
}

function readProject(path) {
  return readFileSync(join(projectRoot, path), "utf8");
}

test("worker HR letter migration is additive and linked to worker profiles", () => {
  const migration = readProject(
    "database/migrations/20260719_worker_hr_letters.sql"
  );

  assert.match(migration, /CREATE TABLE IF NOT EXISTS worker_hr_letters/);
  assert.match(migration, /worker_id BIGINT NOT NULL/);
  assert.match(migration, /FOREIGN KEY \(worker_id\) REFERENCES worker_profiles\(id\)/);
  assert.match(migration, /payload_json JSON NOT NULL/);
  assert.match(migration, /worker_acknowledgement_status/);
  assert.match(migration, /20260719_worker_hr_letters/);
  assert.doesNotMatch(migration, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);
});

test("worker HR letter API supports drafts, issue, acknowledgement, cancellation and PDFs", () => {
  const source = readBackend("routes/workerHrLetterRoutes.js");

  for (const marker of [
    "Employment / Appointment Letter",
    "Notice to Explain / Show Cause",
    "Written Warning Letter",
    "Final Written Warning Letter",
    "Termination of Employment Letter",
    "Promotion / Transfer Letter",
    "Resignation Acceptance and Clearance Letter",
    "WORKER_HR_LETTER_CREATED",
    "WORKER_HR_LETTER_ISSUED",
    "WORKER_HR_LETTER_ACKNOWLEDGED",
    "WORKER_HR_LETTER_CANCELLED",
    "hr-letters/:letterId/pdf",
    "Authorised signature / company stamp",
    "Worker acknowledgement and agreement",
  ]) {
    assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(source, /workers\.documents\.view/);
  assert.match(source, /workers\.documents\.manage/);
  assert.match(source, /workers\.manage/);
  assert.doesNotMatch(source, /UPDATE worker_profiles\s+SET\s+employment_status/i);
});

test("worker HR letters are registered, dynamically backed up and visible", () => {
  const server = readBackend("server.js");
  const schemaService = readBackend("services/workerHrLetterSchemaService.js");
  const systemRoutes = readBackend("routes/systemRoutes.js");
  const backup = readBackend("routes/backupRoutes.js");
  const backupSafety = readBackend("services/backupSafetyService.js");
  const releaseBackup = readBackend("routes/release2FinalRoutes.js");
  const workerPage = readProject("frontend/src/pages/ExpandedWorkerProfilePage.jsx");
  const panel = readProject("frontend/src/components/WorkerHrLettersPanel.jsx");
  const css = readProject("frontend/src/styles/workerHrLetters.css");

  assert.match(server, /workerHrLetterRoutes/);
  assert.match(server, /await ensureWorkerHrLetterSchema\(\)/);
  assert.match(schemaService, /CREATE TABLE IF NOT EXISTS worker_hr_letters/);
  assert.match(schemaService, /worker_id BIGINT NOT NULL/);
  assert.match(schemaService, /Worker HR schema verification failed/);
  assert.match(systemRoutes, /"worker_hr_letters"/);
  assert.match(releaseBackup, /worker_hr_letters/);
  assert.match(backup, /getAllBaseTables/);
  assert.match(backup, /classifyDatabaseTables/);
  assert.match(backupSafety, /currentIncludedTables/);
  assert.match(backupSafety, /Backup is missing current required tables/);
  assert.doesNotMatch(backup, /const PREFERRED_TABLE_ORDER/);
  assert.match(workerPage, /Letters & HR Correspondence/);
  assert.match(workerPage, /WorkerHrLettersPanel/);
  assert.match(panel, /Save Draft Letter/);
  assert.match(panel, /Record Worker Signature \/ Receipt/);
  assert.match(panel, /Rules and Regulations/);
  assert.match(panel, /Authorised boss \/ signatory name/);
  assert.match(css, /\.worker-hr-card/);
});
