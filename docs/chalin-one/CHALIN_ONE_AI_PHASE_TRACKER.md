# CHALIN ONE AI Phase Tracker

**Branch:** `chalin-one`  
**Production flags:** Disabled  
**Live provider:** Disabled  
**Production migration:** Not run  
**Deployment:** Not performed

Legend:

- `[x]` Source implementation and source contracts completed.
- `[-]` Implemented but runtime/database/browser acceptance remains pending.
- `[ ]` Not yet implemented.

## Phase 0 — AI governance matrices

- [x] AI security matrix.
- [x] Data classification matrix.
- [x] Persona separation.
- [x] Risk-level model.
- [x] Prohibited-action list.
- [x] Provider adapter contract.
- [x] Operations and migration runbook.

## Phase 7 — Secure AI foundation

### Source implementation

- [x] Master AI feature gate.
- [x] Independent Copilot, Executive and Guide feature flags.
- [x] Future action and scheduled-job feature flags.
- [x] AI-specific permissions.
- [x] Explicit workspace, branch, mining-site and hire-location scope.
- [x] Prompt-injection detection.
- [x] Secret-extraction blocking.
- [x] Secret redaction.
- [x] High-risk action recognition.
- [x] Provider-disabled default.
- [x] Deterministic test-only mock provider.
- [x] Reviewed-adapter registry boundary.
- [x] Provider timeout and response limits.
- [x] Registered backend tool boundary.
- [x] Direct database/SQL tool rejection.
- [x] Risk-level tool enforcement.
- [x] Request token budget.
- [x] Daily user and workspace budgets.
- [x] Monthly integer-micro cost budget.
- [x] Tool-call loop limit.
- [x] Owned conversation storage.
- [x] Hidden system-message filtering.
- [x] Evidence and citation records.
- [x] Usage ledger.
- [x] Dedicated AI audit events.
- [x] Prompt-safety events.
- [x] Tool invocation audit/status.
- [x] Feedback and correction records.
- [x] Additive 12-table AI migration.
- [x] Read-only AI verifier.
- [x] Guarded manual migration runner.
- [x] Production backup gates.
- [x] Legacy row-count preservation.
- [x] Serial MySQL acceptance source.
- [x] CI migration twice for idempotency.

### Runtime acceptance

- [-] Backend unit/source tests are configured but a visible successful CI run is still required.
- [-] MySQL 8.4 acceptance is configured but a visible successful run is still required.
- [-] Migration idempotency is configured but has not been observed in a successful workflow.
- [-] Provider failure isolation requires browser/API staging acceptance.
- [-] Audit and usage evidence requires staging review.

## Phase 8 — Knowledge and document intelligence

### Source implementation

- [x] Knowledge source identities and classifications.
- [x] Draft knowledge source/version creation.
- [x] Draft updates.
- [x] Exact-version review requests.
- [x] Assigned independent reviewer.
- [x] Self-approval prevention.
- [x] Third-person publisher requirement.
- [x] Superseding prior published versions.
- [x] Effective and expiry dates.
- [x] Public/workspace/executive retrieval separation.
- [x] Restricted sources excluded from automatic retrieval.
- [x] Draft/rejected/expired/superseded/archived retrieval blocked.
- [x] Checksums.
- [x] Evidence conversion.
- [x] Knowledge administration API.
- [x] Workspace ownership enforcement.
- [x] Knowledge governance staff UI.

### Runtime acceptance

- [-] Real MySQL governance flow is configured but not visibly observed as passing.
- [-] Desktop and mobile governance UI acceptance is pending.
- [-] Approved-media/document ingestion remains pending.
- [ ] OCR/document parsing pipeline.
- [ ] Approved chunking/embedding pipeline.
- [ ] Vector retrieval provider.
- [ ] Document-level citation deep links.

## Phase 9 — Chalin Copilot and Executive foundation

### Source implementation

- [x] Protected `/intelligence/*` standalone surface.
- [x] Master feature gate, authentication and existing workspace permission.
- [x] Server-authoritative capability snapshot.
- [x] Independent Copilot and Executive persona switches.
- [x] Explicit Executive permission.
- [x] Owned conversation list/detail/archive/rename.
- [x] Safe provider-disabled state.
- [x] Evidence display.
- [x] Feedback controls.
- [x] Usage ledger UI.
- [x] Responsive desktop/tablet/360–430px layout.
- [x] No sensitive action-execution controls.
- [x] First three read-only foundation tools.

### Runtime acceptance

- [-] Frontend JSX compilation and source tests are configured but not visibly observed as passing.
- [-] Production frontend build result is not visible.
- [-] Browser keyboard/mobile acceptance is pending.
- [-] A live provider is deliberately not registered.
- [ ] Domain insight tools for Spare Parts.
- [ ] Domain insight tools for Mining Operations.
- [ ] Domain insight tools for Equipment Hire.
- [ ] Equipment Sales and Installment Finance tool layer.
- [ ] Executive scorecards and trend panels.
- [ ] Scenario comparison engine.

## Phase 10 — Chalin Guide

- [ ] Anonymous public Guide API.
- [ ] Public-only session storage.
- [ ] Public-only knowledge retrieval.
- [ ] Enquiry handoff.
- [ ] Public rate limits.
- [ ] Public website widget.
- [ ] Abuse and privacy acceptance.

The Guide feature flag remains false.

## Phase 11 — Customer portal

- [ ] Customer identity and access.
- [ ] Customer-scoped data APIs.
- [ ] Portal UI.
- [ ] Approval and privacy acceptance.

## Phase 12 — Supplier portal

- [ ] Supplier identity and access.
- [ ] Supplier-scoped data APIs.
- [ ] Portal UI.
- [ ] Approval and privacy acceptance.

## Phase 13 — Applicant portal

- [ ] Applicant identity and access.
- [ ] Applicant-scoped data APIs.
- [ ] Portal UI.
- [ ] Approval and privacy acceptance.

## Phase 14 — AI action proposals

- [ ] Action proposal records.
- [ ] Independent human review.
- [ ] Exact payload checksum.
- [ ] Expiry and cancellation.
- [ ] Low-risk executor allowlist.
- [ ] Dual-control acceptance.

`FEATURE_AI_ACTIONS` remains false.

## Phase 15 — Scheduled intelligence

- [ ] Approved scheduled-job definitions.
- [ ] Independent approval.
- [ ] Bounded scheduler.
- [ ] Delivery and audit.

`FEATURE_AI_SCHEDULED_JOBS` remains false.

## Phase 16 — Release candidate

- [-] Backend source contracts expanded.
- [-] MySQL CI job expanded.
- [-] Frontend source contracts expanded.
- [ ] Visible green GitHub CI for one exact commit.
- [ ] Isolated staging AI migration twice.
- [ ] Staging provider acceptance.
- [ ] Desktop/mobile browser evidence.
- [ ] Ordinary business regression evidence.
- [ ] Backup and rollback evidence.
- [ ] Management content/provider/cost sign-off.

## Phase 17 — Production release

- [ ] Separate authorization to merge `chalin-one` into `main`.
- [ ] Integrated release verification.
- [ ] Separate authorization to merge `main` into `production`.
- [ ] Signed backup and SQL backup verification.
- [ ] Production migration.
- [ ] Controlled feature activation.
- [ ] Post-release monitoring and rollback drill.

## Current truthful status

The secure AI foundation, governed knowledge workflow and staff intelligence workspace are substantially source-implemented on `chalin-one`.

They are **not production-ready** because no visible successful CI, isolated staging migration, browser acceptance, live provider acceptance or production authorization has occurred.
