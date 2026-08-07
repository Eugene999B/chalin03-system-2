# CHALIN ONE AI Phase Tracker

**Branch:** `chalin-one`  
**Last updated:** August 7, 2026  
**Production flags:** Disabled  
**Live provider:** Disabled  
**Production migration:** Not run  
**Deployment:** Not performed  
**Green Phase 9 source commit:** `ced97c58673e28be8599da2dec6e4a087540f955`  
**Green Phase 9 CI run:** `31208580817`

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
- [x] Registered normal-read and sensitive-read AI permissions.
- [x] Existing business permissions enforced in addition to AI permissions for domain tools.
- [x] Provider tool menus hide tools the account cannot ordinarily access.
- [x] Explicit workspace, Spare Parts branch, Mining site and Hire location scope.
- [x] Mining-site and Hire-location context IDs independently revalidated against existing assignment/scope services.
- [x] Equipment Hire and Equipment Finance AI preserve the backend hard division boundary even though they share the `equipment_hire` workspace code.
- [x] Prompt-injection detection.
- [x] Secret-extraction blocking and sensitive-value redaction.
- [x] High-risk action recognition.
- [x] Provider-disabled default and deterministic mock-provider boundary.
- [x] Provider timeout and response limits.
- [x] Registered backend tool boundary.
- [x] AI, business-permission and equipment-division validation at tool-registration time.
- [x] Direct database/SQL access blocked inside AI tool handlers.
- [x] Risk-level tool enforcement.
- [x] Request, daily-user, workspace and monthly-cost budgets.
- [x] Tool-call loop limits.
- [x] Owned conversation storage and scope isolation.
- [x] Evidence/citation records.
- [x] Usage ledger and dedicated AI audit events.
- [x] Prompt-safety events and tool invocation audit/status.
- [x] Feedback/correction records.
- [x] Additive AI foundation migration and guarded migration runner.
- [x] Production backup gates and legacy row-count preservation.
- [x] Serial MySQL acceptance and migration idempotency CI.

### Runtime acceptance

- [x] Backend suite green on the recorded Phase 9 baseline.
- [x] Isolated MySQL 8.4 AI acceptance green on the recorded Phase 9 baseline.
- [x] AI foundation migration idempotency green.
- [x] AI Actions, Scheduled Intelligence, Public Guide and Portal Security migrations passed twice inside isolated acceptance.
- [x] Security regressions cover unknown permission names, business-permission denial, provider visibility, sensitive evidence classification, forged Mining/Hire context mismatch and Hire-vs-Finance division isolation.
- [-] Real-provider failure isolation still requires controlled staging acceptance.
- [-] Real-account audit and usage evidence still requires staging review.

## Phase 8 — Knowledge and document intelligence

### Source implementation

- [x] Knowledge source identities and classifications.
- [x] Draft knowledge source/version creation and editing.
- [x] Exact-version independent review workflow.
- [x] Self-approval prevention.
- [x] Independent third-person publishing.
- [x] Published-version supersession.
- [x] Effective and expiry dates.
- [x] Public/workspace/executive retrieval separation.
- [x] Draft/rejected/expired/superseded/archived retrieval blocked.
- [x] Checksums and evidence conversion.
- [x] Knowledge administration API and staff governance UI.
- [x] Workspace ownership enforcement.
- [-] Approved-media/document ingestion remains partial; governed text knowledge works, but document-level ingestion is the next source block.
- [ ] OCR/document parsing pipeline.
- [ ] Approved chunking/embedding pipeline.
- [ ] Vector retrieval provider.
- [ ] Document-level citation deep links.

### Runtime acceptance

- [x] Real isolated-MySQL knowledge-governance flow passed CI acceptance.
- [-] Desktop/mobile governance browser acceptance pending.

## Phase 9 — Chalin Copilot and Executive

### Core workspace

- [x] Protected `/intelligence/*` standalone surface.
- [x] Master feature gate, authentication and workspace permission.
- [x] Server-authoritative capability snapshot.
- [x] Independent Copilot and Executive persona switches.
- [x] Explicit Executive permission.
- [x] Owned conversation list/detail/archive/rename.
- [x] Safe provider-disabled state.
- [x] Evidence display, feedback controls and usage ledger UI.
- [x] Responsive desktop/tablet/360–430px source layouts.
- [x] No sensitive action-execution controls.

### Foundation and Spare Parts tools

- [x] Foundation scope/status/knowledge tools.
- [x] `spare_parts.operations_snapshot`.
- [x] `spare_parts.inventory_health`.
- [x] `spare_parts.collections_health`.
- [x] `spare_parts.duplicate_customer_suggestions` using the proven CHALIN identity matcher, masked phones, sensitive-read permission and suggestion-only authority with no merge path.

### Mining Operations tools

- [x] `mining.operations_snapshot`.
- [x] `mining.stock_fuel_health`.
- [x] `mining.production_cost_health`.
- [x] Mining tools revalidate the selected authorized Mining site before execution.

### Equipment Hire tools

- [x] `equipment_hire.operations_snapshot`.
- [x] `equipment_hire.fleet_health`.
- [x] `equipment_hire.receivables_health`.
- [x] Hire tools revalidate the selected authorized Hire location before execution.
- [x] Hire tools are explicitly Hire-division only.

### Equipment Sales / Installment Finance tools

- [x] `equipment_finance.portfolio_health`.
- [x] `equipment_finance.arrears_health`.
- [x] `equipment_finance.cashflow_health`.
- [x] `equipment_finance.sales_pipeline`.
- [x] Finance tools are company-wide, aggregate-only and do not inherit Hire-location selection.
- [x] Finance outputs suppress customer, agreement and payment rows.
- [x] Finance evidence is confidential and read-only.
- [x] KYC/risk and fleet sale-status classifications are locked to the actual schema by regression tests.
- [x] Hire-only users cannot see or execute Finance tools; Finance-only users cannot see or execute Hire tools.

### Executive management intelligence

- [x] Provider-independent Executive Scorecard at `/intelligence/executive-scorecard`.
- [x] Scorecard inherits the existing Group Executive Control original-System-Administrator restriction.
- [x] KPI cards for recorded revenue, cash received, operating cost, receivables, indicative balance and management alerts.
- [x] Business-pulse cards for Spare Parts, Mining, Equipment Hire, Shared Fleet and Cash Control.
- [x] Daily revenue/cash/cost trend visualization.
- [x] Management alert radar and recommendation panel.
- [x] Responsive desktop/tablet/mobile design and reduced-motion support.
- [x] Provider-independent Scenario Comparison Engine at `/intelligence/executive-scenarios`.
- [x] Four scenario presets: Protect Cash, Balanced Plan, Growth Push and Stress Test.
- [x] Custom levers for revenue change, collection-rate change, operating-cost change and existing-receivables recovery.
- [x] Baseline-vs-scenario comparisons for revenue, collections, cash inflow, cost, indicative balance, existing receivables, collection rate and cost ratio.
- [x] Side-by-side comparison visualization.
- [x] Formula transparency panel with no hidden AI calculations.
- [x] Scenario ranges bounded and collection rate clamped to 0–100%.
- [x] Scenario engine is explicitly a no-write management simulation: no forecast claim, no accounting entry, no operational mutation and no AI action proposal.

### Phase 9 acceptance

- [x] Frontend source tests and full JSX compilation passed.
- [x] Production-mode frontend build passed.
- [x] Full backend suite passed.
- [x] Isolated MySQL acceptance and machine-readable release evidence passed.
- [x] Exact Phase 9 baseline `ced97c58673e28be8599da2dec6e4a087540f955` is fully green in CI run `31208580817`.
- [-] Browser keyboard/mobile evidence with real accounts remains pending.
- [-] Live provider remains deliberately unregistered.

## Phase 10 — Chalin Guide

- [x] Anonymous public Guide API foundation.
- [x] Public-only Guide persistence/security schema foundation.
- [x] Public-only approved knowledge retrieval boundary.
- [x] Public rate-limit and privacy controls.
- [x] Public website Guide surface/widget foundation.
- [x] Safety rule forbidding claims of execution, approval or completion of business actions.
- [-] Human enquiry handoff/domain guidance coverage needs staging verification and expansion.
- [-] Abuse/privacy/anonymous browser acceptance pending.
- [-] Real published-content guidance quality acceptance pending.

`FEATURE_CHALIN_GUIDE` remains false outside controlled acceptance.

## Phase 11 — Customer portal

- [x] Shared invitation-only portal account/session/grant/consent/audit schema foundation.
- [ ] Customer business-record ownership APIs.
- [ ] Customer portal UI.
- [ ] Customer-specific recovery/privacy acceptance.

## Phase 12 — Supplier portal

- [x] Shared invitation-only portal account/session/grant/consent/audit schema foundation.
- [ ] Supplier-scoped business APIs.
- [ ] Supplier portal UI.
- [ ] Supplier-specific recovery/privacy acceptance.

## Phase 13 — Applicant portal

- [x] Shared invitation-only portal account/session/grant/consent/audit schema foundation.
- [ ] Applicant-scoped business APIs.
- [ ] Applicant portal UI.
- [ ] Applicant-specific recovery/privacy acceptance.

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
- [x] Isolated MySQL CI expanded.
- [x] Frontend source contracts expanded.
- [x] Visible green GitHub CI for exact Phase 9 source commit `ced97c58673e28be8599da2dec6e4a087540f955` in run `31208580817`.
- [ ] Isolated staging AI migration twice.
- [ ] Staging provider acceptance.
- [ ] Desktop/mobile browser evidence with real accounts.
- [ ] Ordinary business staging regression evidence.
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

Phase 9 is source-complete and CI-proven on `chalin-one`. CHALIN ONE now contains governed Copilot/Executive foundations plus read-only or suggestion-only intelligence for Spare Parts, duplicate customers, Mining Operations, Equipment Hire and Equipment Sales/Installment Finance. It also contains provider-independent Executive Scorecards and a transparent Scenario Comparison Engine driven by the existing original-administrator Group Executive Control baseline.

The next source gap is Phase 8 document intelligence: governed document ingestion, parsing/chunking and later vector retrieval. Staging/browser/live-provider acceptance, backup/restore rehearsal and explicit production authorization remain outstanding. Production feature flags remain disabled, and no production database migration or deployment has been performed.
