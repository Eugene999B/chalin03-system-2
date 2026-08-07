# CHALIN ONE AI Phase Tracker

**Branch:** `chalin-one`  
**Last updated:** August 7, 2026  
**Production flags:** Disabled  
**Live provider:** Disabled  
**Production migration:** Not run  
**Deployment:** Not performed  
**Green source commit:** `463b07a44e0e974fa806dd43bed37eec1ae07086`  
**Green CI run:** `31206956829`

Legend:

- `[x]` Source implementation and the stated source/CI acceptance completed.
- `[-]` Implemented but staging/provider/browser acceptance or a later operational layer remains pending.
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
- [x] AI-specific permissions, including registered normal-read and sensitive-read authority.
- [x] Existing business permissions enforced in addition to AI permissions for domain tools.
- [x] Provider tool menus hide tools the staff account cannot ordinarily access.
- [x] Explicit workspace, branch, mining-site and hire-location scope.
- [x] Mining-site and Hire-location context IDs are independently revalidated against existing assignment/scope services before tool execution.
- [x] Equipment Hire and Equipment Finance AI tools preserve the backend's hard division boundary even though both share the `equipment_hire` workspace code.
- [x] Prompt-injection detection.
- [x] Secret-extraction blocking.
- [x] Secret redaction.
- [x] High-risk action recognition.
- [x] Provider-disabled default.
- [x] Deterministic test-only mock provider.
- [x] Reviewed-adapter registry boundary.
- [x] Provider timeout and response limits.
- [x] Registered backend tool boundary.
- [x] AI, business-permission and equipment-division validation at tool-registration time.
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

- [x] Backend unit/source suite passed in the recorded green CI run.
- [x] Isolated MySQL 8.4 AI acceptance passed in the recorded green CI run.
- [x] AI foundation migration idempotency passed in the recorded green CI run.
- [x] Governed AI Actions, Scheduled Intelligence, Public Guide and Portal Security migrations passed twice inside isolated database acceptance.
- [x] Domain-tool security regression tests cover unknown permission names, business-permission denial, provider visibility, sensitive evidence classification, forged Mining/Hire context mismatch and Hire-vs-Finance division isolation.
- [-] Provider failure isolation still requires browser/API staging acceptance.
- [-] Audit and usage evidence still requires staging review with real accounts.

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

- [x] Real isolated-MySQL governance flow passed CI acceptance.
- [-] Desktop and mobile governance UI browser acceptance is pending.
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
- [x] Responsive desktop/tablet/360–430px source layout.
- [x] No sensitive action-execution controls.
- [x] First three read-only foundation tools.
- [x] Spare Parts operations snapshot tool.
- [x] Spare Parts inventory-health tool.
- [x] Spare Parts collections-health tool.
- [x] Sensitive duplicate-customer suggestions using the proven customer-identity matcher, masked phones, stronger permissions and suggestion-only authority with no merge path.
- [x] Mining Operations snapshot tool.
- [x] Mining stockpile-and-fuel health tool.
- [x] Mining production, cost and equipment-utilization health tool.
- [x] Equipment Hire operations snapshot tool.
- [x] Equipment Hire fleet-health tool.
- [x] Equipment Hire receivables-health tool.
- [x] Equipment Finance portfolio-health tool.
- [x] Equipment Finance arrears-health tool.
- [x] Equipment Finance cash-flow-health tool.
- [x] Equipment sales / credit-application pipeline tool.
- [x] Finance tools are company-wide, aggregate-only and do not require or inherit Hire location selection.
- [x] Finance AI suppresses customer/agreement/payment rows and exposes only governed confidential aggregate evidence.
- [x] Finance application KYC/risk and fleet sale-status classifications are locked to the actual schema by regression tests.
- [x] Domain tools require existing ordinary business permissions as well as AI permissions.
- [x] Mining and Hire tools validate actual authorized site/location assignment before execution.
- [x] Hire-only users cannot see or execute Finance AI tools; Finance-only users cannot see or execute Hire AI tools.

### Runtime acceptance

- [x] Frontend JSX compilation and source tests passed CI.
- [x] Production-mode frontend build passed CI.
- [x] Spare Parts, customer-identity, Mining, Equipment Hire and Equipment Finance domain-tool source/security tests passed the backend suite in the recorded green CI run.
- [x] Isolated MySQL acceptance and machine-readable release evidence passed on the exact recorded Finance source commit.
- [-] Browser keyboard/mobile acceptance is pending.
- [-] A live provider is deliberately not registered.
- [x] Domain insight tools for Spare Parts.
- [x] Domain insight tools for Mining Operations.
- [x] Domain insight tools for Equipment Hire.
- [x] Equipment Sales and Installment Finance tool layer.
- [ ] Executive scorecards and trend panels.
- [ ] Scenario comparison engine.

## Phase 10 — Chalin Guide

### Source implementation

- [x] Anonymous public Guide API foundation.
- [x] Public-only Guide persistence/security schema foundation.
- [x] Public-only approved knowledge retrieval boundary.
- [x] Public rate-limit and privacy controls.
- [x] Public website Guide surface/widget foundation.
- [x] Prompt safety rule that forbids claiming execution, approval or completion of business actions.
- [-] Human enquiry handoff/domain guidance coverage needs staging verification and expansion.

### Runtime acceptance

- [x] Public Guide migration passed twice inside isolated MySQL acceptance.
- [-] Abuse, privacy and anonymous browser acceptance remain pending.
- [-] Real published-content guidance quality acceptance remains pending.

`FEATURE_CHALIN_GUIDE` remains false outside controlled acceptance.

## Phase 11 — Customer portal

- [x] Shared invitation-only portal account/session/grant/consent/audit schema foundation.
- [ ] Customer business-record ownership APIs.
- [ ] Customer portal UI.
- [ ] Customer-specific recovery and privacy acceptance.

## Phase 12 — Supplier portal

- [x] Shared invitation-only portal account/session/grant/consent/audit schema foundation.
- [ ] Supplier-scoped business APIs.
- [ ] Supplier portal UI.
- [ ] Supplier-specific recovery and privacy acceptance.

## Phase 13 — Applicant portal

- [x] Shared invitation-only portal account/session/grant/consent/audit schema foundation.
- [ ] Applicant-scoped business APIs.
- [ ] Applicant portal UI.
- [ ] Applicant-specific recovery and privacy acceptance.

The three portal feature flags remain false.

## Phase 14 — AI action proposals

- [x] Action proposal records.
- [x] Independent human review.
- [x] Exact payload checksum.
- [x] Expiry and cancellation.
- [x] Additive action-governance migration and isolated MySQL idempotency acceptance.
- [x] No-executor security invariant.
- [ ] Low-risk executor allowlist.
- [-] Dual-control browser acceptance and Approval Inbox integration.

`FEATURE_AI_ACTIONS` remains false and no action executor is active.

## Phase 15 — Scheduled intelligence

- [x] Approved scheduled-job definition records.
- [x] Independent approval/review records.
- [x] Additive scheduled-governance migration and isolated MySQL idempotency acceptance.
- [x] Run-evidence schema without an active runner.
- [x] No-runner/no-delivery security invariant.
- [ ] Bounded operational scheduler.
- [ ] Delivery channels and delivery audit.

`FEATURE_AI_SCHEDULED_JOBS` remains false and no scheduler is active.

## Phase 16 — Release candidate

- [x] Backend source contracts expanded.
- [x] Isolated MySQL CI job expanded.
- [x] Frontend source contracts expanded.
- [x] Visible green GitHub CI for exact source commit `463b07a44e0e974fa806dd43bed37eec1ae07086` in run `31206956829`.
- [ ] Isolated staging AI migration twice.
- [ ] Staging provider acceptance.
- [ ] Desktop/mobile browser evidence.
- [ ] Ordinary business regression evidence.
- [ ] Full-system backup and rollback evidence.
- [ ] Management content/provider/cost sign-off.

## Phase 17 — Production release

- [ ] Separate authorization to merge `chalin-one` into `main`.
- [ ] Integrated release verification.
- [ ] Separate authorization to merge `main` into `production`.
- [ ] Signed full-system backup and SQL backup verification.
- [ ] Production migration.
- [ ] Controlled feature activation.
- [ ] Post-release monitoring and rollback drill.

## Current truthful status

The secure AI foundation, governed knowledge workflow, staff intelligence workspace, public Guide foundation, AI action-governance foundation, scheduled-intelligence governance foundation and shared portal-security foundation are source-implemented on `chalin-one`. Spare Parts, customer identity, Mining Operations, Equipment Hire and Equipment Sales/Installment Finance now have governed read-only/suggestion-only domain intelligence tools with ordinary business-permission enforcement, provider visibility filtering, Mining/Hire assignment revalidation, and hard Hire-vs-Finance Equipment division isolation. Finance intelligence is company-wide, aggregate-only and suppresses customer/agreement/payment rows. The exact source commit `463b07a44e0e974fa806dd43bed37eec1ae07086` passed the **fully green recorded source/isolated-MySQL CI run `31206956829`**.

They are **still not production-ready** because isolated staging, real-account browser acceptance, live-provider acceptance, ordinary-business staging regression, full-system backup/restore rehearsal and explicit production authorization remain outstanding. Production feature flags remain disabled and no production database migration or deployment has been performed.
