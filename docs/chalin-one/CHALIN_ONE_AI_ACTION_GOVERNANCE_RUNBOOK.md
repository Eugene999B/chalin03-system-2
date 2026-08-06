# CHALIN ONE AI Action Governance Runbook

**Feature flag:** `FEATURE_AI_ACTIONS`  
**Default:** `false`  
**Execution support in this release:** None  
**Production authorization:** Not granted

## 1. Purpose

The action-governance foundation records evidence-backed AI action proposals for independent human review.

It does not execute an action.

The foundation provides:

- Registered action metadata.
- Explicit persona, workspace, risk and permission boundaries.
- Canonical JSON payloads.
- SHA-256 payload integrity.
- Approved evidence snapshots.
- Expiry.
- Independent assigned reviewer.
- Approve or reject decision.
- Proposer or protected-administrator cancellation.
- Audit events.
- Zero-execution verification.

## 2. Absolute boundary

The source contains no:

- Executor callback.
- SQL command field.
- Shell command field.
- Generic HTTP command field.
- Business mutation handler.
- `/execute` route.
- Automatic execution after approval.
- Scheduled execution.

An approved proposal remains an inert governance record.

## 3. Schema

Migration:

```text
database/migrations/20260806_chalin_one_ai_action_governance.sql
```

Tables:

1. `ai_action_proposals`
2. `ai_action_reviews`

Verifier:

```text
database/migrations/20260806_chalin_one_ai_action_governance_verify.sql
```

The verifier requires zero proposals with `proposal_status='executed'` during this foundation release.

## 4. Migration safety

Normal runtime gates:

```text
CHALIN_ONE_ALLOW_AI_ACTION_SCHEMA_MIGRATION=false
CHALIN_ONE_AI_ACTION_MIGRATION_CONFIRM=
```

Isolated rehearsal gates:

```text
CHALIN_ONE_ALLOW_AI_ACTION_SCHEMA_MIGRATION=true
CHALIN_ONE_AI_ACTION_MIGRATION_CONFIRM=20260806_CHALIN_ONE_AI_ACTION_GOVERNANCE
```

Run the guarded migration twice against only:

```text
chalin_one_acceptance*
chalin_one_staging*
chalin_one_development*
```

Production additionally requires both independent backup confirmations and separate release authorization.

## 5. Action definition contract

Action definitions are metadata only:

```js
{
  key,
  version,
  title,
  description,
  risk_level,
  personas,
  allowed_workspaces,
  required_permissions,
  evidence_required,
  maximum_expiry_hours,
  input_schema,
  output_authority: "proposal_only",
  execution_available: false
}
```

The registry rejects any `execute`, `handler` or `run` function.

No action definition is considered release-ready until its business permission, evidence requirement, reviewer role and rollback procedure are separately approved.

## 6. Proposal lifecycle

```text
Authorized proposer
  → registered definition
  → explicit workspace/location scope
  → canonical payload
  → payload SHA-256
  → approved evidence snapshot
  → independent assigned reviewer
  → pending review
      → approved (still inert)
      → rejected
      → cancelled
      → expired
```

The proposer cannot approve their own proposal.

A proposal assigned to one reviewer cannot be decided by another user.

Payload integrity is rechecked before detail display and decision.

## 7. Evidence requirements

A definition may require evidence. When required, an empty evidence list blocks proposal creation.

Stored evidence is the safe normalized representation:

- Citation.
- Source type.
- Source reference.
- Source version.
- Label.
- Redacted excerpt.
- As-of time.
- Classification.
- Workspace.
- Safe metadata.

The proposal must not store provider credentials, database secrets or raw authentication tokens.

## 8. Expiry and cancellation

Each definition sets a maximum expiry window from 1 to 168 hours.

Expired draft, pending or approved proposals are marked `expired`.

Cancellation is permitted only before execution states and only by:

- The original proposer, or
- The protected original System Administrator.

Because this release has no executor, the normal terminal states are:

```text
approved
rejected
cancelled
expired
```

## 9. Required integration before staging

The proposal-only route source is:

```text
backend/routes/aiActionRoutes.js
```

Before staging it may be mounted only below authenticated staff AI routes:

```text
/api/ai/actions
  → FEATURE_AI_ENABLED
  → authenticated staff
  → workspace.view
  → FEATURE_AI_ACTIONS
  → AI proposal/review permission
```

Do not mount the action routes in the anonymous public API.

Do not register business action definitions until their own contracts are approved.

## 10. Staging acceptance

Verify:

1. `FEATURE_AI_ACTIONS=false` hides all proposal routes.
2. No action definitions means proposal creation is unavailable.
3. Definitions with executor functions are rejected.
4. Unsupported persona/workspace is denied.
5. Missing proposal permission is denied.
6. Cross-workspace proposal is denied.
7. Missing evidence is denied where required.
8. Same proposer and reviewer is denied.
9. Canonical payload order produces one checksum.
10. Payload tampering blocks review.
11. Wrong reviewer is denied.
12. Self-approval is denied.
13. Approved proposal remains inert.
14. No `/execute` route exists.
15. No business table row changes during acceptance.
16. Expired proposal is not reviewable.
17. Cancellation retains audit evidence.
18. Verifier reports zero executed proposals.

## 11. Future execution release

A later low-risk execution release requires all of the following before any executor is added:

- Separately approved action definition.
- Existing business service entry point.
- Exact business permission check.
- Independent approval.
- Payload checksum revalidation.
- Expiry.
- Idempotency key.
- Database transaction.
- Before/after evidence.
- Compensating rollback.
- Dedicated acceptance test.
- Staging browser evidence.
- Management authorization.

High-risk actions may remain proposal-only permanently.

## 12. Current truthful state

The action schema, verifier, guarded migration runner, metadata-only registry, proposal service, proposal-only route source, tests and this runbook are implemented on `chalin-one`.

They are not mounted, migrated, enabled, database-tested, browser-tested or production-authorized.
