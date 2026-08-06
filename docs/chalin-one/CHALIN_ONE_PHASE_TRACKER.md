# CHALIN ONE — Implementation Phase Tracker

**Last updated:** August 6, 2026  
**Development branch:** `chalin-one`

This tracker is the source of truth for CHALIN ONE work. A checked source item means the code or document exists on `chalin-one`; it does not automatically mean browser, database, staging or production acceptance has passed.

## Permanent release rule

1. All CHALIN ONE development and testing happens on `chalin-one`.
2. Current production fixes may be synchronized from `main` into `chalin-one` after inspection.
3. CHALIN ONE is not merged into `main` in small pieces.
4. After the complete accepted release candidate is ready, `chalin-one` is merged into `main`.
5. The complete integrated `main` branch is verified.
6. Only verified `main` is merged into `production`.
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
- [-] Complete final AI permission, tool, risk and approval matrices
- [-] Complete final portal and sensitive-data classification matrices
- [ ] Complete production cutover and rollback checklist after staging acceptance

### Phase 0 gate

- [x] No CHALIN ONE production deployment configuration changed
- [x] `main` and `production` remain protected from incomplete CHALIN ONE releases
- [-] Architecture documents agree with current code; AI and portal documents remain incomplete

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

- [-] Existing operations remain usable when feature-status requests fail
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
- [ ] Confirm a completed successful MySQL CI execution
- [ ] Rehearse on an isolated staging database
- [ ] Rehearse on a recent safe production copy before release

### Phase 2 gate

- [x] Migration is additive and repeat-safe by source contract
- [ ] Real MySQL run reports no structural or foreign-key errors
- [ ] Existing business records and totals remain unchanged in staging rehearsal
- [ ] Previous application version remains operational against the expanded schema

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
- [ ] Confirm successful database-backed CI execution
- [ ] Complete staging API and privacy acceptance

### Phase 3 gate

- [x] Anonymous routes return only public-shaped records by source contract
- [x] Public submissions are validated and audited by source contract
- [ ] Database proof that no draft or archived content leaks
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
- [ ] Confirm successful MySQL acceptance execution
- [ ] Exercise a dedicated staging R2 bucket and media hostname

### Phase 4 gate

- [x] Editors cannot publish without required permission by route and service contract
- [x] Submitters cannot approve their own exact versions
- [x] Previous versions restore only as new drafts
- [x] Media archive protection covers live and draft references
- [ ] All supported scheduling passes database-backed acceptance
- [ ] Full Content Studio transaction acceptance passes

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
- [-] Editor → reviewer → publisher workflow is implemented; end-to-end staging proof pending
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
- [-] Existing staff login remains operational by source contract; browser proof pending
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
- [ ] Confirm the latest full GitHub Actions run is green
- [ ] Provision the isolated preview database, API, frontend and media store
- [ ] Run migration twice in staging
- [ ] Run the seed against staging
- [ ] Review, approve and publish verified staging content
- [ ] Complete operational regression testing
- [ ] Capture acceptance evidence and management sign-off

### Release B gate

- [ ] Backend, frontend and MySQL CI jobs are green
- [ ] Preview website and Content Studio pass browser acceptance
- [ ] Existing Spare Parts, Mining, Hire and Finance workflows pass regression
- [ ] No unverified address, leadership, testimonial, vacancy or tender is published
- [ ] Backup, rollback and emergency-disable evidence is complete

---

# Phase 7 — AI Security and Provider Foundation

- [ ] AI database migration and verification
- [ ] AI provider abstraction and failure handling
- [ ] Registered backend tool catalogue
- [ ] AI permission and workspace-scope engine
- [ ] Evidence and calculation summaries
- [ ] Conversation and approved knowledge services
- [ ] Immutable AI audit, usage and cost controls
- [ ] Prompt-injection and sensitive-data protections
- [ ] Emergency AI shutdown acceptance

### Phase 7 gate

- [ ] AI never connects directly to MySQL
- [ ] AI calls only registered backend tools
- [ ] Every tool repeats normal permission and scope checks
- [ ] AI outage does not affect ordinary Chalin 03 operation

---

# Phase 8 — AI Knowledge and Feedback

- [ ] Approved knowledge sources and versions
- [ ] Workspace, visibility, effective-date and expiry scope
- [ ] Retrieval with evidence and citations
- [ ] Feedback, corrections and review
- [ ] Knowledge administration and security tests

---

# Phase 9 — Chalin Copilot Read-Only Release

- [ ] Sales, inventory and reorder intelligence
- [ ] Customer 360, duplicate suggestions and statements
- [ ] Debt, collections and reminder drafts
- [ ] Accounting, closing and anomaly explanations
- [ ] Documents, system health, backups and reports
- [ ] Floating Copilot and full intelligence workspace
- [ ] Evidence, feedback, role and location-isolation tests

---

# Phase 10 — AI Approval and Controlled Actions

- [ ] AI action proposals and Approval Inbox integration
- [ ] Approve, reject, request-change and expiry workflow
- [ ] Before/after previews, locks and idempotency
- [ ] Approved communications, quotations, reports and stock proposals
- [ ] Controlled-action security tests

---

# Phase 11 — Chalin Executive

- [ ] Executive-only permissions and stronger authentication
- [ ] Private executive conversations
- [ ] Group-wide briefs, forecasts, risks and scenarios
- [ ] Executive reports and security tests

---

# Phase 12 — Chalin Guide and Public Enquiries

- [ ] Isolated public persona and tool allowlist
- [ ] Company, equipment, quotation, hire and finance guidance
- [ ] Careers, enquiries and human handoff
- [ ] Consent, abuse and public-isolation tests

---

# Phase 13 — External Portals

- [ ] Customer portal
- [ ] Supplier portal
- [ ] Applicant portal
- [ ] Ownership, document, notification and recovery security

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

- [ ] Application and document completeness
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

1. Confirm and fix the complete CHALIN ONE CI run.
2. Provision isolated Release B staging.
3. Run the migration twice and seed controlled drafts.
4. Complete real author, reviewer and publisher acceptance.
5. Finish browser, mobile, accessibility and operational regression testing.
6. Freeze the Release B candidate and prepare integration evidence.
7. Begin the secure AI foundation only after Release B acceptance.

---

# Final Release Acceptance

- [ ] No unresolved critical or high-severity defect
- [ ] Latest `main` production fixes are synchronized into the release candidate
- [ ] Full backend, frontend and MySQL tests/builds pass
- [ ] Permission, workspace and location isolation pass
- [ ] Migration rehearsal passes on a recent safe production copy
- [ ] Backup and restore rehearsal passes
- [ ] Desktop and mobile acceptance passes
- [ ] Public/private and AI-disabled regressions pass
- [ ] Exact release-candidate commit is frozen and recorded
- [ ] Final production backups are completed and verified
- [ ] Eugene authorizes `chalin-one → main`
- [ ] Complete integrated `main` verification passes
- [ ] Eugene authorizes `main → production`
- [ ] Cloudflare and Railway deploy from `production`
- [ ] Production smoke test and monitoring period pass
