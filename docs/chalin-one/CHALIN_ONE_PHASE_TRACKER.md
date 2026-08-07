# CHALIN ONE — Implementation Phase Tracker

**Last updated:** August 7, 2026  
**Development branch:** `chalin-one`

This tracker is the source of truth for CHALIN ONE work. A checked source item means the code or document exists on `chalin-one`; it does not automatically mean browser, staging, provider or production acceptance has passed.

## Latest CI evidence

- Exact green source commit: `e4b4c19397b9a579a4dabec8805d72fdefb92d27`
- GitHub Actions run: `31200046205`
- Backend tests, staging safety, migration safety and syntax: **passed**
- Frontend manager tests, JSX compilation, full tests and production build: **passed**
- Isolated MySQL 8.4 public-content + AI database acceptance: **passed**
- Public-content and AI-foundation migrations twice for idempotency: **passed**
- Governed AI Actions, Scheduled Intelligence, Public Guide and Portal Security migrations twice: **passed inside database acceptance**
- Machine-readable release evidence generation/upload: **passed**
- Production deployment and production database migration: **not performed**

## Permanent release rule

1. All CHALIN ONE development and testing happens on `chalin-one`.
2. Current production fixes may be synchronized from `main` into `chalin-one` only after inspection.
3. CHALIN ONE is not merged into `main` in small pieces.
4. After the complete accepted release candidate is ready, `chalin-one` is merged into `main` only with explicit authorization.
5. The complete integrated `main` branch is verified.
6. Only verified `main` is merged into `production` with explicit authorization.
7. Cloudflare and Railway production deploy only from `production`.
8. Production is never deployed directly from `chalin-one` or an unverified `main` commit.

## Status legend

- `[ ]` Not started
- `[-]` In progress, source-complete with execution pending, or partially complete
- `[x]` Completed at the stated level
- `[!]` Blocked

---

# Phase 0 — Branch, Architecture and Governance

- [x] Create and preserve the `chalin-one` development branch
- [x] Record the `chalin-one → main → production` release flow
- [x] Add master architecture, release flow and database runbooks
- [x] Add public-content schema and media documentation
- [x] Add staging environment and acceptance runbook
- [x] AI permission, provider, tool, risk and approval source matrices
- [x] Portal security and sensitive-data source classification foundation
- [ ] Complete production cutover and rollback checklist after staging acceptance

### Phase 0 gate

- [x] No CHALIN ONE production deployment configuration changed
- [x] `main` and `production` remain protected from incomplete CHALIN ONE releases
- [x] Architecture/source contracts cover the implemented public, AI and portal-security foundations

---

# Phase 1 — Feature Flag Foundation

- [x] Backend feature-flag service
- [x] Public-safe and staff feature-status endpoints
- [x] Frontend feature context and route guards
- [x] Fail-closed disabled-feature handling
- [x] Master AI emergency switch and dependency enforcement
- [x] Source and unit contracts
- [-] Real browser verification with all flags disabled
- [-] Staging verification with only Public Website and Content Studio enabled

### Phase 1 gate

- [x] Existing operations remain protected by fail-closed source and CI contracts when CHALIN ONE features are disabled
- [x] Disabled frontend and backend capabilities fail closed by source contract
- [x] Feature flags do not replace authentication, permissions or workspace checks

---

# Phase 2 — Public Content Database

- [x] Additive 28-table public-content schema
- [x] Pages, versions, sections, media and forms
- [x] Navigation, settings, approvals and immutable audit
- [x] News, announcements, leadership and divisions
- [x] Projects, project media and equipment catalogue
- [x] Testimonials, locations, statistics, vacancies, tenders and FAQs
- [x] Manual guarded migration runner
- [x] Advisory lock, exact confirmation and business-row count protection
- [x] Read-only verification SQL
- [x] MySQL 8.4 acceptance job configured in CHALIN ONE CI
- [x] Second migration run configured for idempotency proof
- [x] Completed successful isolated MySQL 8.4 CI execution
- [ ] Rehearse on an isolated staging database
- [ ] Rehearse on a recent safe production copy before release

### Phase 2 gate

- [x] Migration is additive and repeat-safe by source contract and isolated MySQL execution
- [x] Isolated MySQL run reports no structural or foreign-key errors
- [ ] Existing business records and totals remain unchanged in staging rehearsal
- [ ] Previous application version remains operational against the expanded schema in staging rehearsal

---

# Phase 3 — Public Content APIs

- [x] Published-only bootstrap and page APIs
- [x] News and announcements
- [x] Leadership and business divisions
- [x] Projects and public equipment catalogue
- [x] Locations, statistics, testimonials and FAQs
- [x] Vacancies and tenders
- [x] Dynamic public forms
- [x] Consent, spam, privacy and rate-limit controls
- [x] Draft, archived, future and expired-content exclusion
- [x] Safe public media joins
- [x] Database-backed acceptance suite written
- [x] Successful database-backed CI execution
- [ ] Complete staging API and privacy acceptance

### Phase 3 gate

- [x] Anonymous routes return only public-shaped records by source contract and isolated MySQL acceptance
- [x] Public submissions are validated and audited by source contract
- [x] Database proof that unpublished/draft content does not leak through accepted public collections
- [ ] Browser proof that no internal API or private operational data is exposed

---

# Phase 4 — Content Studio Backend

## Core governance

- [x] Central Content Studio permission catalogue
- [x] Pages, sections, version history and restore-as-draft
- [x] Exact-version independent review and approval
- [x] Self-approval and assigned-reviewer controls
- [x] Navigation and website settings
- [x] Private Enquiry Desk
- [x] Unified Approval Inbox services
- [x] Immutable content and platform audit evidence

## Content managers

- [x] News categories, articles and announcements
- [x] Leadership profiles
- [x] Projects and project galleries
- [x] Public equipment catalogue
- [x] Business divisions
- [x] Locations
- [x] Company statistics
- [x] Testimonials
- [x] FAQs
- [x] Vacancies
- [x] Tenders
- [x] Versioned public Form Builder

## Media Library

- [x] Folder hierarchy and usage visibility
- [x] JPEG, PNG and WebP processing through Sharp
- [x] Responsive WebP variants and duplicate detection
- [x] Cloudflare R2 adapter
- [x] Local adapter that cannot create public URLs
- [x] Approved external HTTPS video registration
- [x] Reference-safe archive protection
- [-] Secure public document-upload pipeline for tender documents

## Scheduling and acceptance

- [x] Page publishing and expiry scheduler foundation
- [x] Newer managers fail closed on unsupported future scheduling
- [-] Version-aware scheduling for every manager
- [x] Real-service MySQL acceptance suite written
- [x] Successful MySQL acceptance execution
- [ ] Exercise a dedicated staging R2 bucket and media hostname

### Phase 4 gate

- [x] Editors cannot publish without required permission by route and service contract
- [x] Submitters cannot approve their own exact versions
- [x] Previous versions restore only as new drafts
- [x] Media archive protection covers live and draft references
- [-] All supported immediate-publishing flows pass isolated database acceptance; universal future scheduling remains pending
- [x] Governed Content Studio database transaction acceptance passes in isolated MySQL

---

# Phase 5 — Content Studio Frontend

- [x] Responsive Content Studio shell and dashboard
- [x] Governed Page Manager
- [x] Newsroom and announcement manager
- [x] Leadership manager
- [x] Projects manager
- [x] Public Equipment manager
- [x] Company Information managers
- [x] Media Library interface
- [x] No-code public Form Builder
- [x] Website settings manager
- [x] Navigation manager
- [x] Enquiry Desk
- [x] Unified Approval Inbox
- [x] Feature, authentication and permission guards
- [x] Desktop and mobile responsive source design
- [x] JSX and manager source contracts
- [-] Advanced visual page-section controls and drag ordering
- [-] Side-by-side version comparison
- [-] Desktop, tablet and mobile draft preview
- [ ] Real browser acceptance with author, reviewer and publisher accounts

### Phase 5 gate

- [-] A non-programmer can update company content by implemented UI; browser proof pending
- [-] A non-programmer can upload and reuse media; staging storage proof pending
- [-] Editor → reviewer → publisher workflow is implemented and database-proven; real-account staging proof pending
- [ ] Mobile and desktop preview match public rendering
- [ ] Frontend and backend permissions pass a real account matrix

---

# Phase 6 — Separate Public Website Renderer

- [x] Standalone `/website/*` application entry
- [x] Separate anonymous Axios client
- [x] Accessible responsive design foundation
- [x] Homepage renderer
- [x] Published Page and section renderer
- [x] Business divisions and leadership
- [x] Projects and equipment catalogue
- [x] News and announcements
- [x] Locations and FAQs
- [x] Careers and tenders
- [x] Testimonials
- [x] Dynamic public forms
- [x] Header and footer navigation
- [x] Staff Login link and full application-shell handoff
- [x] No staff token, workspace headers or operational overlays
- [x] Raw HTML, `eval` and arbitrary iframe rendering blocked
- [-] Homepage page-builder sections should become fully visual and reusable
- [-] Media gallery page
- [-] Final SEO, social metadata and sitemap
- [-] Image/video performance and accessibility audit
- [ ] Deploy to an isolated preview hostname
- [ ] Complete desktop and mobile browser acceptance

### Phase 6 gate

- [x] Public renderer uses only published public APIs by source contract
- [x] Public site is isolated from staff authentication and private APIs by source contract
- [x] Existing staff login handoff passes frontend source/CI contracts; browser proof remains pending
- [ ] Mobile performance and accessibility acceptance pass

---

# Release B — Staging and Release Candidate Acceptance

- [x] Isolated staging environment verifier
- [x] Production host and database blocking
- [x] Three-user independent review requirement
- [x] Dedicated local/R2 media isolation rules
- [x] One-time migration-mode verification
- [x] Normal runtime migration-gate closure verification
- [x] Idempotent draft-only staging seed
- [x] Core Home, About and Contact drafts
- [x] Five business-division drafts
- [x] Core FAQ, statistic and contact-form drafts
- [x] Header and footer navigation drafts
- [x] Staging environment template and runbook
- [x] Staging safety tests and CI contract
- [x] Latest full source/isolated-DB GitHub Actions run is green
- [ ] Provision the isolated preview database, API, frontend and media store
- [ ] Run migration twice in staging
- [ ] Run the seed against staging
- [ ] Review, approve and publish verified staging content
- [ ] Complete operational regression testing
- [ ] Capture browser/staging acceptance evidence and management sign-off

### Release B gate

- [x] Backend, frontend and isolated MySQL CI jobs are green
- [ ] Preview website and Content Studio pass browser acceptance
- [ ] Existing Spare Parts, Mining, Hire and Finance workflows pass staging regression
- [ ] No unverified address, leadership, testimonial, vacancy or tender is published in staging/production
- [ ] Backup, rollback and emergency-disable evidence is complete

---

# Phase 7 — AI Security and Provider Foundation

- [x] AI database migration and verification source
- [x] AI provider abstraction and failure handling
- [x] Registered backend tool catalogue
- [x] AI permission and workspace-scope engine
- [x] Evidence and calculation summaries
- [x] Conversation and approved knowledge services
- [x] Immutable AI audit, usage and cost controls
- [x] Prompt-injection and sensitive-data protections
- [-] Emergency AI shutdown browser/API staging acceptance

### Phase 7 gate

- [x] AI/provider layer has no direct arbitrary SQL tool path by source and CI invariant
- [x] AI calls only registered backend tools
- [x] Registered tools repeat required permission and scope checks by contract
- [x] Provider-disabled/default state is isolated from ordinary Chalin 03 operations by source/CI contracts

---

# Phase 8 — AI Knowledge and Feedback

- [x] Approved knowledge sources and versions
- [x] Workspace, visibility, effective-date and expiry scope
- [x] Retrieval with evidence and citations
- [x] Feedback, corrections and review
- [x] Knowledge administration and security tests
- [x] Isolated MySQL governance acceptance
- [ ] Approved document ingestion/vector retrieval production design
- [ ] Browser acceptance for knowledge administration

---

# Phase 9 — Chalin Copilot Read-Only Release

- [ ] Sales, inventory and reorder intelligence domain tools
- [ ] Customer 360, duplicate suggestions and statements domain tools
- [ ] Debt, collections and reminder-draft domain tools
- [ ] Accounting, closing and anomaly-explanation domain tools
- [ ] Documents, system health, backups and reports domain tools
- [x] Floating/standalone intelligence workspace foundation
- [x] Evidence, feedback, role and location-isolation source/CI contracts
- [ ] Live-provider and browser acceptance

---

# Phase 10 — AI Approval and Controlled Actions

- [-] AI action proposals and human-review governance foundation implemented; unified Approval Inbox integration remains pending
- [-] Approve/reject/cancel/expiry workflow implemented; request-change workflow remains pending
- [ ] Before/after previews, execution locks and idempotent executor
- [ ] Approved communications, quotations, reports and stock proposal executors
- [x] Controlled-action security and no-executor source/CI tests

`FEATURE_AI_ACTIONS` remains disabled; no action executor is active.

---

# Phase 11 — Chalin Executive

- [x] Executive-only permission and persona separation foundation
- [x] Private executive conversation foundation
- [ ] Group-wide briefs, forecasts, risks and scenarios
- [ ] Executive reports and browser/security acceptance

---

# Phase 12 — Chalin Guide and Public Enquiries

- [x] Isolated public Guide persona, public API boundary and tool allowlist foundation
- [-] Company/equipment/hire/finance guidance foundation; domain coverage expansion remains pending
- [-] Careers/enquiry/human handoff foundation requires staging/browser verification
- [-] Consent, abuse, rate-limit and public-isolation source protections implemented; browser acceptance pending

`FEATURE_CHALIN_GUIDE` remains disabled outside controlled acceptance.

---

# Phase 13 — External Portals

- [x] Shared invitation-only portal security schema, sessions, grants, consent and audit foundation
- [ ] Customer portal business APIs and UI
- [ ] Supplier portal business APIs and UI
- [ ] Applicant portal business APIs and UI
- [ ] Ownership, document, notification and recovery end-to-end security acceptance

Portal feature flags remain disabled.

---

# Phase 14 — Mining Intelligence

- [ ] Production, fuel, downtime, maintenance and shift intelligence
- [ ] Site comparisons, forecasts and incident summaries
- [ ] Mining scope and accuracy tests

---

# Phase 15 — Equipment Hire Intelligence

- [ ] Availability, conflicts, utilization and profitability
- [ ] Contracts, billing, quotations, dispatch and returns
- [ ] Hire scope and accuracy tests

---

# Phase 16 — Equipment Finance Intelligence

- [ ] Application and document completeness intelligence
- [ ] Schedule, overdue, collections and delivery intelligence
- [ ] Risk, reminder and management-review proposals
- [ ] Finance decision-boundary tests

---

# Phase 17 — Voice, Vision and Advanced Intelligence

- [ ] Voice and transcription confirmation
- [ ] Twi evaluation
- [ ] Spare-part and equipment image assistance
- [ ] GPS, sensors and predictive maintenance
- [ ] Business digital twin and executive command room

---

# Current immediate work order

1. Preserve the green `chalin-one` source/CI baseline; do not merge or deploy it.
2. Provision isolated Release B preview/staging infrastructure and database.
3. Run approved migrations twice and seed controlled staging drafts.
4. Complete real author, reviewer and publisher browser acceptance on desktop/mobile.
5. Run ordinary Spare Parts, Mining, Hire and Finance staging regression with CHALIN ONE flags controlled.
6. Complete AI staging acceptance with provider still disabled first, then controlled live-provider testing only when configured.
7. Finish remaining domain AI tools, universal scheduling/preview polish and external portal business surfaces.
8. Freeze a release candidate only after staging/browser/regression evidence is complete.

---

# Final Release Acceptance

- [ ] No unresolved critical or high-severity defect after staging/browser acceptance
- [ ] Latest required `main` production fixes are deliberately synchronized into the release candidate
- [x] Full CHALIN ONE backend, frontend and isolated MySQL tests/builds pass on an exact recorded commit
- [ ] Permission, workspace and location isolation pass real-account staging acceptance
- [ ] Migration rehearsal passes on a recent safe production copy
- [ ] Full-system backup and restore rehearsal passes
- [ ] Desktop and mobile acceptance passes
- [ ] Public/private and AI-disabled staging regressions pass
- [ ] Exact final release-candidate commit is frozen and recorded
- [ ] Final production backups are completed and verified
- [ ] Eugene authorizes `chalin-one → main`
- [ ] Complete integrated `main` verification passes
- [ ] Eugene authorizes `main → production`
- [ ] Cloudflare and Railway deploy from `production`
- [ ] Production smoke test and monitoring period pass
