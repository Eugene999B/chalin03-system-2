"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  AiScheduledJobRegistry,
  AiScheduledJobRegistryError,
  normalizeDefinition,
} = require("../services/aiScheduledJobRegistry");
const {
  AiScheduledGovernanceError,
  canonicalJson,
  normalizeSchedule,
  normalizeScope,
  sha256,
} = require("../services/aiScheduledJobGovernanceService");

const repoRoot = path.resolve(__dirname, "../..");
const serviceSource = fs.readFileSync(
  path.join(
    repoRoot,
    "backend/services/aiScheduledJobGovernanceService.js"
  ),
  "utf8"
);
const routeSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/aiScheduledJobRoutes.js"),
  "utf8"
);
const migrationSource = fs.readFileSync(
  path.join(
    repoRoot,
    "database/migrations/20260806_chalin_one_ai_scheduled_governance.sql"
  ),
  "utf8"
);

function definition(overrides = {}) {
  return {
    key: "operations.daily_briefing",
    version: "1",
    title: "Daily operational briefing",
    description: "Approved schedule metadata for a future read-only briefing.",
    personas: ["copilot"],
    allowed_workspaces: ["mining"],
    required_permissions: ["ai.actions.propose"],
    evidence_required: true,
    minimum_interval_minutes: 1440,
    input_schema: { type: "object" },
    ...overrides,
  };
}

test("scheduled definitions are metadata-only and reject runners or delivery functions", () => {
  const item = normalizeDefinition(definition());
  assert.equal(item.runner_available, false);
  assert.equal(item.delivery_available, false);
  assert.equal(item.output_authority, "approved_schedule_definition_only");

  for (const field of ["execute", "handler", "run", "deliver"]) {
    assert.throws(
      () => normalizeDefinition(definition({ [field]: async () => true })),
      (error) =>
        error instanceof AiScheduledJobRegistryError &&
        error.code === "AI_SCHEDULED_JOB_RUNNER_PROHIBITED"
    );
  }
});

test("scheduled registry controls duplicates, persona and workspace filters", () => {
  const registry = new AiScheduledJobRegistry();
  registry.register(definition());
  assert.equal(
    registry.list({ persona: "copilot", workspace: "mining" }).length,
    1
  );
  assert.equal(
    registry.list({ persona: "executive", workspace: "mining" }).length,
    0
  );
  assert.equal(
    registry.list({ persona: "copilot", workspace: "spare_parts" }).length,
    0
  );
  assert.throws(
    () => registry.register(definition()),
    (error) =>
      error instanceof AiScheduledJobRegistryError &&
      error.code === "AI_SCHEDULED_JOB_DEFINITION_DUPLICATE"
  );
});

test("bounded hourly, daily, weekly and monthly schedules normalize safely", () => {
  assert.deepEqual(
    normalizeSchedule(
      {
        frequency: "daily",
        timezone: "Africa/Accra",
        hour: 8,
        minute: 30,
      },
      1440
    ),
    {
      schedule: {
        frequency: "daily",
        timezone: "Africa/Accra",
        minute: 30,
        hour: 8,
      },
      interval_minutes: 1440,
    }
  );
  assert.equal(
    normalizeSchedule(
      {
        frequency: "weekly",
        timezone: "UTC",
        weekdays: [1, 5],
        hour: 7,
        minute: 0,
      },
      1440
    ).schedule.weekdays.length,
    2
  );
  assert.equal(
    normalizeSchedule(
      {
        frequency: "monthly",
        timezone: "Africa/Accra",
        days_of_month: [1, 15],
        hour: 9,
      },
      1440
    ).schedule.days_of_month.length,
    2
  );
  assert.throws(
    () =>
      normalizeSchedule(
        {
          frequency: "hourly",
          timezone: "Africa/Accra",
          interval_hours: 1,
        },
        1440
      ),
    (error) =>
      error instanceof AiScheduledGovernanceError &&
      error.code === "AI_SCHEDULED_FREQUENCY_TOO_HIGH"
  );
});

test("schedule timezone, weekly days and monthly days fail closed", () => {
  assert.throws(
    () =>
      normalizeSchedule(
        { frequency: "daily", timezone: "America/New_York" },
        1440
      ),
    (error) => error.code === "AI_SCHEDULED_TIMEZONE_INVALID"
  );
  assert.throws(
    () =>
      normalizeSchedule(
        { frequency: "weekly", timezone: "UTC", weekdays: [] },
        1440
      ),
    (error) => error.code === "AI_SCHEDULED_WEEKDAY_REQUIRED"
  );
  assert.throws(
    () =>
      normalizeSchedule(
        { frequency: "monthly", timezone: "UTC", days_of_month: [] },
        1440
      ),
    (error) => error.code === "AI_SCHEDULED_MONTH_DAY_REQUIRED"
  );
});

test("schedule and input JSON receive deterministic integrity hashes", () => {
  const first = canonicalJson({ workspace: "mining", window: 7 });
  const second = canonicalJson({ window: 7, workspace: "mining" });
  assert.equal(first, second);
  assert.equal(sha256(first), sha256(second));
  assert.match(sha256(first), /^[a-f0-9]{64}$/);
  assert.equal(normalizeScope({ workspace_code: "mining", mining_site_id: 3 }).mining_site_id, 3);
});

test("scheduled lifecycle requires evidence, independent review and integrity", () => {
  assert.match(serviceSource, /AI_SCHEDULED_EVIDENCE_REQUIRED/);
  assert.match(serviceSource, /AI_SCHEDULED_INDEPENDENT_REVIEW_REQUIRED/);
  assert.match(serviceSource, /AI_SCHEDULED_SELF_APPROVAL_BLOCKED/);
  assert.match(serviceSource, /AI_SCHEDULED_REVIEW_ASSIGNED_ELSEWHERE/);
  assert.match(serviceSource, /AI_SCHEDULED_INTEGRITY_FAILED/);
  assert.match(serviceSource, /schedule_status = 'archived'/);
  assert.match(serviceSource, /runner_available: false/);
  assert.match(serviceSource, /delivery_available: false/);
});

test("scheduled routes provide governance only and no run or delivery endpoint", () => {
  assert.match(routeSource, /requireFeature\("aiScheduledJobs"\)/);
  assert.match(routeSource, /ai\.actions\.propose/);
  assert.match(routeSource, /ai\.actions\.review/);
  assert.match(routeSource, /\/decision/);
  assert.match(routeSource, /\/archive/);
  assert.doesNotMatch(routeSource, /\/run|runNow|execute|deliver/);
});

test("scheduled migration remains additive and contains no runnable command field", () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS ai_scheduled_job_definitions/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS ai_scheduled_job_reviews/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS ai_scheduled_job_run_evidence/);
  assert.match(migrationSource, /schedule_sha256 CHAR\(64\)/);
  assert.match(migrationSource, /input_sha256 CHAR\(64\)/);
  assert.doesNotMatch(
    migrationSource,
    /DROP\s+(?:TABLE|DATABASE)|TRUNCATE|DELETE\s+FROM|RENAME\s+TABLE/i
  );
  assert.doesNotMatch(
    migrationSource,
    /sql_text|command_text|shell_command|webhook_url|recipient_token/i
  );
});
