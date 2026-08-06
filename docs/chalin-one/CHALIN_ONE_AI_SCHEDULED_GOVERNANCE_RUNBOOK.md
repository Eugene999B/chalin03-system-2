# CHALIN ONE Scheduled Intelligence Governance Runbook

**Feature flag:** `FEATURE_AI_SCHEDULED_JOBS`  
**Default:** `false`  
**Scheduler/runner:** Not implemented in this release  
**Delivery:** Not implemented in this release

## 1. Purpose

This foundation stores evidence-backed scheduled-intelligence definitions for independent human review.

It does not run a schedule.

It provides:

- Registered schedule metadata.
- Explicit persona and workspace boundaries.
- Bounded hourly, daily, weekly and monthly schedule formats.
- `Africa/Accra` and `UTC` time only.
- Definition-specific minimum interval.
- Canonical schedule and input JSON.
- SHA-256 integrity checks.
- Approved evidence snapshots.
- Independent assigned review.
- Approve, reject and archive lifecycle.
- Audit evidence.
- Zero-run verification.

## 2. Absolute boundary

The source contains no:

- Timer.
- Cron process.
- Queue worker.
- Alarm.
- Scheduled provider call.
- Registered tool invocation.
- Delivery function.
- Email/SMS/WhatsApp recipient token.
- Webhook target.
- “Run now” endpoint.
- Automatic activation after approval.

An approved schedule remains an inert governance record.

## 3. Schema

Migration:

```text
database/migrations/20260806_chalin_one_ai_scheduled_governance.sql
```

Tables:

1. `ai_scheduled_job_definitions`
2. `ai_scheduled_job_reviews`
3. `ai_scheduled_job_run_evidence`

The run-evidence table exists for a later separately approved release. This foundation requires it to contain zero rows.

Verifier:

```text
database/migrations/20260806_chalin_one_ai_scheduled_governance_verify.sql
```

## 4. Migration gates

Normal runtime:

```text
CHALIN_ONE_ALLOW_AI_SCHEDULED_SCHEMA_MIGRATION=false
CHALIN_ONE_AI_SCHEDULED_MIGRATION_CONFIRM=
```

One isolated rehearsal command:

```text
CHALIN_ONE_ALLOW_AI_SCHEDULED_SCHEMA_MIGRATION=true
CHALIN_ONE_AI_SCHEDULED_MIGRATION_CONFIRM=20260806_CHALIN_ONE_AI_SCHEDULED_GOVERNANCE
```

Allowed non-production databases:

```text
chalin_one_acceptance*
chalin_one_staging*
chalin_one_development*
```

Run the guarded migration twice for idempotency, then close the gates.

Production requires both verified backups and separate release authorization.

## 5. Job-definition contract

Registered job definitions are metadata only:

```js
{
  key,
  version,
  title,
  description,
  personas,
  allowed_workspaces,
  required_permissions,
  evidence_required,
  minimum_interval_minutes,
  input_schema,
  output_authority: "approved_schedule_definition_only",
  runner_available: false,
  delivery_available: false
}
```

The registry rejects `execute`, `handler`, `run` and `deliver` functions.

## 6. Schedule format

Supported formats:

### Hourly

```json
{
  "frequency": "hourly",
  "timezone": "Africa/Accra",
  "interval_hours": 1,
  "minute": 0
}
```

### Daily

```json
{
  "frequency": "daily",
  "timezone": "Africa/Accra",
  "hour": 8,
  "minute": 0
}
```

### Weekly

```json
{
  "frequency": "weekly",
  "timezone": "Africa/Accra",
  "weekdays": [1, 5],
  "hour": 8,
  "minute": 0
}
```

Weekdays use 1–7.

### Monthly

```json
{
  "frequency": "monthly",
  "timezone": "Africa/Accra",
  "days_of_month": [1, 15],
  "hour": 8,
  "minute": 0
}
```

Days are restricted to 1–28 to avoid ambiguous month-end behavior.

A job definition may require a minimum interval longer than the schedule requested. The request then fails closed.

## 7. Governance lifecycle

```text
Authorized requester
  → registered metadata-only job
  → explicit workspace/location
  → bounded schedule
  → canonical schedule checksum
  → canonical input checksum
  → approved evidence snapshot
  → independent assigned reviewer
  → pending review
      → approved (still inert)
      → rejected
      → archived
```

The requester cannot approve their own schedule.

A schedule assigned to one reviewer cannot be decided by another user.

Schedule and input integrity are rechecked before detail display and decision.

## 8. Required integration before staging

Route source:

```text
backend/routes/aiScheduledJobRoutes.js
```

It may be mounted only below authenticated staff AI routes:

```text
/api/ai/scheduled
  → FEATURE_AI_ENABLED
  → authenticated staff
  → workspace.view
  → FEATURE_AI_SCHEDULED_JOBS
  → AI proposal/review permission
```

Do not mount it into the public API.

Do not register actual job definitions until the report content, audience, evidence, frequency and cost budget are separately approved.

## 9. Staging acceptance

Verify:

1. Feature false hides all scheduled routes.
2. Definitions with runner or delivery functions are rejected.
3. Unsupported persona/workspace is denied.
4. Cross-workspace schedules are denied.
5. Missing evidence is denied where required.
6. Same requester and reviewer is denied.
7. Unsupported timezone is denied.
8. Sub-hour schedules are denied unless a later approved definition explicitly permits hourly operation; the platform minimum remains one hour.
9. Invalid weekly/monthly dates are denied.
10. Canonical schedule order produces one checksum.
11. Schedule or input tampering blocks review.
12. Wrong reviewer is denied.
13. Self-approval is denied.
14. Approved schedule remains inert.
15. No `/run` or delivery endpoint exists.
16. Run-evidence table remains empty.
17. Archive retains audit and review evidence.
18. Ordinary business routes remain unaffected.

## 10. Later scheduler release

A future scheduler requires:

- Separately approved read-only job definition.
- Explicit service identity and least privilege.
- Distributed lock.
- Idempotent run key.
- Maximum hourly frequency.
- Provider and token budget.
- Tool-call budget.
- Evidence requirement.
- Delivery allowlist.
- Quiet hours.
- Retry and dead-letter policy.
- Run evidence.
- Emergency disable switch.
- Staging load and failure testing.
- Management authorization.

## 11. Current truthful state

The scheduled schema, verifier, guarded runner, metadata-only registry, governance service, non-running route source, tests and this runbook are implemented on `chalin-one`.

They are not mounted, migrated, enabled, registered with actual jobs, run, delivered, browser-tested or production-authorized.
