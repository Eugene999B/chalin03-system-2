# CHALIN ONE — AI Security, Tool and Approval Matrix

**Status:** Development source of truth  
**Default runtime state:** Every AI flag disabled  
**Applies to:** Chalin Copilot, Chalin Executive and Chalin Guide

## Non-negotiable controls

1. The model never receives a database connection, SQL client or unrestricted repository/service container.
2. The model may call only tools registered in the backend AI tool registry.
3. Every tool invocation repeats authentication, effective-permission, workspace and location checks.
4. Tool handlers receive an immutable, minimized execution context rather than the Express request or database pool.
5. Tool input and output size are bounded and hashed for audit evidence.
6. Provider prompts are screened for prompt injection, credential requests and system-instruction extraction.
7. Provider errors, timeouts and quota failures must fail only the AI request; ordinary Chalin 03 routes remain available.
8. Provider API keys are environment secrets and are never stored in AI tables, returned by APIs or written to logs.
9. Every answer must identify its evidence or state that no approved evidence was available.
10. AI cannot approve its own knowledge, proposal or action.

## Personas

| Persona | Audience | Required feature flags | Base access | Data boundary |
|---|---|---|---|---|
| Chalin Copilot | Authenticated staff | `aiEnabled`, `chalinCopilot` | Existing `workspace.view` plus `ai.use` | Active workspace, branch, mining site or hire location only |
| Chalin Executive | Explicit executives | `aiEnabled`, `chalinExecutive` | `ai.executive.use` and protected executive identity | Group-wide only where the user already holds executive visibility |
| Chalin Guide | Anonymous/public | `aiEnabled`, `publicWebsite`, `chalinGuide` | Public allowlist only | Published public content and approved public knowledge only |

Public and staff tools must never share an unrestricted registry context.

## AI permissions

| Permission | Purpose | Default grant |
|---|---|---|
| `ai.use` | Open staff Copilot and request read-only assistance | Denied; original protected administrator only during foundation |
| `ai.tools.view` | View the effective registered tool catalogue | Same as `ai.use` |
| `ai.conversations.view` | Read own scoped conversations | Same as `ai.use` |
| `ai.conversations.manage` | Rename/archive own scoped conversations | Same as `ai.use` |
| `ai.feedback.create` | Submit answer feedback or correction | Same as `ai.use` |
| `ai.knowledge.view` | Search approved internal knowledge | Explicit grant |
| `ai.knowledge.manage` | Create sources and draft versions | Explicit administrator/knowledge-owner grant |
| `ai.knowledge.review` | Review an exact knowledge version | Explicit independent reviewer grant |
| `ai.knowledge.publish` | Publish an approved exact version | Explicit publisher grant |
| `ai.audit.view` | Inspect AI conversations, tools, safety and usage evidence | Auditor/security grant |
| `ai.usage.view` | View scoped AI token and cost usage | Manager/auditor grant |
| `ai.usage.manage` | Change approved provider budgets and limits | Protected administrator grant |
| `ai.executive.use` | Use the private executive persona | Explicit executive grant plus stronger authentication |
| `ai.actions.propose` | Prepare a controlled action proposal | Future Phase 10 grant |
| `ai.actions.review` | Independently review an AI proposal | Future Phase 10 grant |
| `ai.actions.execute` | Execute an approved low-risk proposal | Future Phase 10 grant and `aiActions` flag |

The foundation is deliberately deny-by-default. Broad role grants must not be introduced until the real account matrix passes in staging.

## Tool risk levels

| Level | Authority | Allowed foundation behaviour | Approval requirement |
|---|---|---|---|
| 1 | Read | Search, summarize and calculate from authorized read services | No separate action approval; normal data permission still required |
| 2 | Recommend | Produce reorder, collection or operational recommendations | Human decision outside AI |
| 3 | Prepare | Draft reports, quotations, reminders or communications | Draft cannot be sent or published automatically |
| 4 | Execute approved low-risk action | Future execution of an already approved proposal | Exact proposal approval, idempotency key and execution audit |
| 5 | Sensitive change | Merge, price, stock, finance or release changes | Explicit specialist approval; some operations remain permanently prohibited |

## Permanently prohibited autonomous actions

AI may not autonomously:

- Delete or alter finalized sales, payments, debts or audit records.
- Merge customers.
- Change product prices or stock balances.
- Approve installment or equipment-finance applications.
- Release equipment, dispatch assets or close financial contracts.
- Restore a database or change backup retention.
- Create, deactivate or change permissions for administrators.
- Send mass SMS, WhatsApp or email communications.
- Modify approval, audit-signoff or document-signature evidence.
- Store or reveal passwords, tokens, provider secrets or database credentials.

## Tool registration contract

Every registered tool declares:

- Stable tool key and version.
- Human-readable title and description.
- Allowed personas.
- Risk level.
- Required normal business permissions.
- Allowed workspaces.
- Whether branch, mining-site or hire-location scope is required.
- Input schema and maximum serialized input bytes.
- Maximum output bytes.
- Evidence requirements.
- Timeout.

A tool is rejected at registration when metadata is incomplete, its risk exceeds the enabled release, or its handler attempts to receive a database/pool/SQL object.

## Provider contract

The provider adapter receives only:

- Sanitized conversation messages.
- Approved system instructions for the selected persona.
- Registered tool schemas allowed for that user and scope.
- Bounded approved knowledge/evidence excerpts.
- Request budget and timeout.

The adapter returns normalized text, optional tool-call requests, token counts, model identifier and finish reason. Unknown providers fail closed. A deterministic mock provider is allowed only in test or explicitly isolated staging mode.

## Knowledge governance

Knowledge lifecycle:

```text
Draft source/version
  → exact version submitted
  → independent reviewer approves or rejects
  → publisher publishes approved exact version
  → previous published version becomes superseded
```

Requirements:

- Owner workspace and visibility are mandatory.
- Effective and expiry dates are enforced.
- Search returns only published, currently effective versions.
- Public visibility is a separate explicit classification.
- Source text is checksummed.
- Reviewer cannot be the submitter.
- Provider answers cite returned evidence records.

## Audit and retention

The foundation records:

- Conversation and message identity.
- Persona and effective scope.
- Safety decision and redaction count.
- Provider/model identifiers without secrets.
- Tool key, version, risk, input hash, result status and latency.
- Evidence references.
- Token counts and estimated cost in integer micros.
- Request ID and actor.
- Feedback and correction status.

Raw secret values and unrestricted tool payloads are never audit fields.

## Emergency shutdown

Setting `FEATURE_AI_ENABLED=false` must immediately make every staff and public AI route return a controlled feature-disabled response. Ordinary public website, Content Studio and business-operation routes remain independent.

Additional switches independently disable:

- Chalin Copilot.
- Chalin Executive.
- Chalin Guide.
- AI actions.
- AI scheduled jobs.

## Acceptance gate

The AI foundation is not accepted until all of the following pass:

- Additive migration and second-run idempotency.
- Provider-disabled and provider-timeout tests.
- Tool registry allowlist tests.
- Permission, workspace, branch, mining-site and hire-location tests.
- Prompt-injection and secret-redaction tests.
- Output-size and request-budget tests.
- Independent knowledge approval tests.
- Immutable audit and usage evidence tests.
- AI-disabled regression proving ordinary Chalin 03 operation remains available.
