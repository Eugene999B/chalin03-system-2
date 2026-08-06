# CHALIN ONE Secure AI Foundation Runbook

**Release scope:** AI foundation, Chalin Copilot foundation, Chalin Executive foundation and governed knowledge  
**Default state:** Disabled  
**Production impact of this document:** None  
**Database migration:** Manual only

## 1. Purpose

This runbook governs preparation and acceptance of the CHALIN ONE AI foundation without giving a model direct database, credential or operational authority.

The foundation provides:

- Explicit AI personas and permissions.
- Workspace, branch, mining-site and hire-location scope.
- A registered backend tool boundary.
- Prompt-injection and secret-extraction controls.
- Provider isolation and timeouts.
- Owned staff conversations.
- Governed knowledge with exact-version review and publication.
- Evidence and citations.
- Usage and cost ledgers.
- Dedicated AI audit and prompt-safety events.
- Feedback and correction records.
- A protected `/intelligence/*` staff workspace.

It does **not** authorize:

- A production database migration.
- Enabling any AI feature flag.
- Adding a live model provider.
- Giving AI direct MySQL access.
- Giving AI unrestricted file, shell, network or environment access.
- Executing customer merges, stock changes, finance decisions, equipment release, backup restoration, permission changes or mass communication.
- Merging `chalin-one` into `main` or `production`.
- Cloudflare or Railway deployment.

## 2. Permanent safety architecture

The request path is:

```text
Authenticated staff session
  → existing workspace permission
  → AI master feature flag
  → persona feature flag
  → AI permission
  → explicit workspace/location scope
  → prompt safety inspection
  → request budget
  → published knowledge retrieval
  → permission-filtered registered tools
  → provider adapter
  → output safety inspection
  → evidence + usage + audit persistence
```

A provider never receives:

- Database credentials.
- JWT or session tokens.
- Raw request/response objects.
- MySQL pool or connection objects.
- Arbitrary SQL.
- The full environment.
- Data outside the active scope.

A registered tool handler receives only:

```text
input
actor id / username / role
persona
workspace code
branch / mining site / hire location scope
permission snapshot
tool key / version / risk
request id
```

## 3. Feature switches

All switches remain false during normal development until separately accepted:

```text
FEATURE_AI_ENABLED=false
FEATURE_CHALIN_COPILOT=false
FEATURE_CHALIN_EXECUTIVE=false
FEATURE_CHALIN_GUIDE=false
FEATURE_AI_ACTIONS=false
FEATURE_AI_SCHEDULED_JOBS=false
AI_PROVIDER=disabled
AI_ALLOW_MOCK_PROVIDER=false
```

`FEATURE_AI_ENABLED` is the master emergency shutdown.

`FEATURE_AI_ACTIONS` does not become true merely because Copilot or Executive is enabled. Risk-level 4 and 5 tools remain blocked while it is false.

## 4. Database foundation

Migration:

```text
database/migrations/20260806_chalin_one_ai_foundation.sql
```

Read-only verifier:

```text
database/migrations/20260806_chalin_one_ai_foundation_verify.sql
```

Manual runner:

```text
backend/scripts/runChalinOneAiFoundationMigration.js
```

The 12 additive tables are:

1. `ai_provider_profiles`
2. `ai_conversations`
3. `ai_messages`
4. `ai_tool_invocations`
5. `ai_evidence_records`
6. `ai_usage_ledger`
7. `ai_audit_events`
8. `ai_prompt_safety_events`
9. `ai_knowledge_sources`
10. `ai_knowledge_versions`
11. `ai_knowledge_approvals`
12. `ai_feedback`

No AI table may contain password, secret, API-key, access-token, refresh-token, JWT, database-URL or database-password columns.

## 5. Isolated migration rehearsal

Use only a database matching one of:

```text
chalin_one_acceptance*
chalin_one_staging*
chalin_one_development*
```

Keep normal runtime gates closed:

```text
CHALIN_ONE_ALLOW_AI_SCHEMA_MIGRATION=false
CHALIN_ONE_AI_MIGRATION_CONFIRM=
```

For the single controlled migration command set:

```text
CHALIN_ONE_ALLOW_AI_SCHEMA_MIGRATION=true
CHALIN_ONE_AI_MIGRATION_CONFIRM=20260806_CHALIN_ONE_AI_FOUNDATION
```

Then run from `backend`:

```bash
npm run migrate:chalin-one:ai-foundation
npm run migrate:chalin-one:ai-foundation
```

The second run proves idempotency.

Immediately restore:

```text
CHALIN_ONE_ALLOW_AI_SCHEMA_MIGRATION=false
CHALIN_ONE_AI_MIGRATION_CONFIRM=
```

The runner additionally verifies:

- Advisory migration lock.
- All 12 tables.
- InnoDB.
- `utf8mb4` collation.
- Migration record.
- No forbidden secret columns.
- No change to captured legacy business row counts.

## 6. Production migration prerequisites

A production AI migration remains prohibited until a later authorized release.

When that release is separately approved, the runner additionally requires:

```text
CHALIN03_SIGNED_BACKUP_CONFIRMED=true
CHALIN03_SQL_BACKUP_CONFIRMED=true
```

Both backup artifacts must be verified independently before opening migration gates.

## 7. Provider acceptance

The default provider is `disabled`.

The deterministic `mock` provider is allowed only when:

- `NODE_ENV=test`, or
- a visibly isolated non-production environment explicitly sets `AI_ALLOW_MOCK_PROVIDER=true`.

The mock provider is always blocked in production.

A live provider adapter must not be registered until it passes the separate provider contract in `CHALIN_ONE_AI_PROVIDER_ADAPTER_CONTRACT.md`.

Provider credentials remain environment-only. They are never returned by `/api/ai/status`, stored in AI tables or included in audit metadata.

## 8. Knowledge governance

A knowledge record follows:

```text
Author creates draft source/version
  → author submits exact version to another user
  → assigned reviewer approves or rejects
  → a third publisher publishes the approved exact version
```

The same user may not be:

- Submitter and reviewer.
- Submitter and publisher.
- Reviewer and publisher.

Retrieval rules:

- Guide: published public knowledge only.
- Copilot: published public plus active-workspace knowledge.
- Executive: published public, workspace and executive knowledge.
- Restricted knowledge: not automatically retrieved by any persona in this foundation release.
- Draft, rejected, expired, superseded and archived versions: never retrieved.

## 9. Staff workspace acceptance

The protected staff route is:

```text
/intelligence/*
```

Acceptance must verify:

- Master AI feature disabled returns to the normal staff shell.
- Anonymous access is denied.
- Missing `workspace.view` is denied.
- Copilot and Executive switches are independent.
- Executive requires explicit `ai.executive.use`.
- Tool list contains only tools permitted to the current account and workspace.
- Conversation history is own-account only.
- Hidden system messages never appear in returned history.
- Evidence remains visible after reload.
- Provider-disabled state is clear and does not affect ordinary operations.
- No action-execution control exists.
- 360–430px mobile layout remains usable.

## 10. Automated acceptance

Backend unit/source contracts cover:

- Permissions and scopes.
- Prompt injection, secret requests and redaction.
- Provider disabled/mock/timeout behavior.
- Registered tool risk and direct-DB rejection.
- Request, daily, workspace, tool-call and monthly budgets.
- Evidence deduplication, citations and required-evidence enforcement.
- Three-person knowledge governance.
- Route and feature-gate architecture.
- Additive migration safety.
- Prompt-once and multi-provider-round usage accounting.

The MySQL CI job:

1. Creates the isolated legacy fixture.
2. Runs the public-content migration twice.
3. Runs the AI foundation migration twice.
4. Executes all serial public and AI acceptance tests.
5. Generates release evidence.

No GitHub CI result may be described as passing until the workflow run and jobs are visibly successful.

## 11. Emergency shutdown

For any AI incident:

1. Set `FEATURE_AI_ENABLED=false`.
2. Keep `FEATURE_AI_ACTIONS=false`.
3. Set `AI_PROVIDER=disabled`.
4. Preserve AI audit, safety, invocation and usage records.
5. Do not delete evidence to hide the incident.
6. Confirm ordinary sales, debt, mining, hire and finance workflows remain available.

## 12. Current release boundary

The foundation is limited to:

- Read.
- Explain.
- Summarize.
- Compare.
- Recommend.
- Prepare drafts.

It does not execute sensitive operational changes.

Chalin Guide, additional operational domain tools, Customer/Supplier/Applicant portals, action approval workflows, scheduled AI jobs and production provider activation remain later separately accepted releases.
