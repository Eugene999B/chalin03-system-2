# CHALIN ONE — Implementation Phase Tracker

This tracker is the source of truth for CHALIN ONE work on the `chalin-one` branch.

## Permanent release rule

1. All CHALIN ONE development and testing happens on `chalin-one`.
2. Nothing is merged while the full CHALIN ONE project is still being built.
3. After the entire project is accepted, `chalin-one` is merged into `main`.
4. The complete integrated `main` branch is verified.
5. Only the verified `main` release is merged into `production`.
6. Cloudflare and Railway production deploy from `production`.
7. Production is never deployed directly from `chalin-one` or an unverified `main` commit.

## Status legend

- `[ ]` Not started
- `[-]` In progress or code-complete with acceptance still pending
- `[x]` Completed and verified at the stated level
- `[!]` Blocked

---

# Phase 0 — Branch and Governance Foundation

- [x] Create `chalin-one` from the approved starting `main` commit
- [x] Record the permanent `chalin-one → main → production` release flow
- [x] Add master architecture and phase tracker
- [-] Complete AI permission, tool, risk and approval matrices
- [-] Complete public-content, portal and data-classification matrices
- [ ] Add final staging, cutover and rollback acceptance checklist

### Phase 0 gate

- [-] Architecture documents agree with current workspaces and roles
- [x] No production deployment configuration changed by CHALIN ONE work
- [x] `main` and `production` remain untouched by CHALIN ONE commits

---

# Phase 1 — Feature Flag Foundation

- [x] Backend feature-flag service
- [x] Staff and public-safe feature-status endpoints
- [x] Frontend feature context and route/visibility guards
- [x] Controlled disabled-feature responses
- [x] Master AI emergency switch and dependency enforcement
- [x] Focused feature-flag tests
- [-] Full integration verification after final synchronization with current `main`

### Phase 1 gate

- [-] Existing system operates normally with every CHALIN ONE flag disabled
- [x] Disabled frontend features fail closed
- [x] Disabled backend routes fail closed
- [x] Flags do not replace authentication, permission or workspace checks

---

# Phase 2 — Public Content Database

- [x] Additive public-content schema and migration contract
- [x] Page, version and reusable section tables
- [x] Navigation, settings, approvals and immutable audit tables
- [x] News, announcements, leadership and division tables
- [x] Projects, project media and equipment catalogue tables
- [x] Testimonials, locations and company statistics tables
- [x] Vacancies, tenders, FAQs and forms tables
- [x] Media Library and private submission-file tables
- [x] Indexes, uniqueness rules and foreign keys
- [x] Manual guarded migration runner and verification contract
- [x] Migration safety checks in CHALIN ONE CI
- [ ] Rehearse migration on an isolated database
- [ ] Rehearse migration on a recent safe production copy

### Phase 2 gate

- [-] Migration is additive and repeat-safe by source contract
- [ ] Real MySQL verification reports no structural errors
- [ ] Existing production tables and totals remain unchanged in rehearsal
- [ ] Previous application version remains operational against expanded schema

---

# Phase 3 — Public Content APIs

- [x] Published-only public-content service
- [x] Pages, news and announcements
- [x] Leadership and divisions
- [x] Projects and public equipment catalogue
- [x] Locations, statistics, testimonials and FAQs
- [x] Vacancies and tenders
- [x] Public forms and privacy-safe submissions
- [x] Consent, validation, spam and rate-limit controls
- [x] Draft/archive exclusion, cache controls and pagination
- [x] Focused public API and security tests
- [ ] MySQL-backed public API acceptance

### Phase 3 gate

- [-] Anonymous users can read only published content by source contract
- [-] Public submissions are validated, rate-limited and audited by source contract
- [ ] Database-backed proof that no draft or archived content leaks
- [ ] Database-backed proof that no internal operational data is exposed

---

# Phase 4 — Chalin Content Studio Backend

## Core governance

- [x] Central Content Studio permissions and user overrides
- [x] Pages, sections, version history and restoration
- [x] Independent review, approval and publishing
- [x] Navigation and website settings management
- [x] Private enquiry/submission desk
- [x] Immutable content and platform audit evidence

## Content managers

- [x] News categories, articles and rolling announcements
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
- [x] Secure JPEG, PNG and WebP processing through Sharp
- [x] Responsive WebP variants and duplicate detection
- [x] Cloudflare R2 production adapter
- [x] Local development adapter that cannot publish
- [x] External HTTPS video registration with host allowlist
- [x] Reference-safe archive protection for live and draft content
- [-] Secure public document-upload pipeline for tender documents

## Scheduling and verification

- [x] Page publishing/expiry scheduler foundation
- [-] Version-aware scheduler for every newer content manager
- [x] Newer managers fail closed on future scheduling until accepted
- [x] Focused manager, workflow, security and schema-contract tests
- [ ] Apply migration and run real transaction/foreign-key acceptance
- [ ] Exercise a dedicated R2 test bucket and media domain
- [ ] Run full branch-wide backend CI after final `main` synchronization

### Phase 4 gate

- [-] Editors cannot publish without permission by source contract
- [-] Submitters cannot approve their own versions by source contract
- [-] Previous versions restore only as new drafts
- [-] Media replacement and archive protections cover live and draft references
- [ ] Scheduled publication and expiry are version-aware for every manager
- [ ] Full database-backed Content Studio acceptance passes

---

# Phase 5 — Chalin Content Studio Frontend

- [ ] Content Studio shell and responsive dashboard
- [ ] Page and reusable-section builder
- [ ] Newsroom and announcement manager
- [ ] Leadership, projects and equipment managers
- [ ] Company-information managers
- [ ] Media Library and upload interface
- [ ] Public Form Builder interface
- [ ] Website settings and navigation interfaces
- [ ] Submission/Enquiry Desk
- [ ] Publishing Approval Inbox
- [ ] Version comparison and restore interface
- [ ] Desktop, tablet and mobile public preview
- [ ] Frontend permission and feature-flag guards
- [ ] Frontend acceptance tests

### Phase 5 gate

- [ ] A non-programmer can update and preview company content
- [ ] A non-programmer can upload and reuse approved media
- [ ] Editor → reviewer → publisher workflow works end to end
- [ ] Mobile and desktop previews match public rendering
- [ ] Frontend and backend permissions agree

---

# Phase 6 — Separate Public Website

- [ ] Create isolated `public-website` application
- [ ] Shared accessible design system
- [ ] Homepage, About and Company History
- [ ] Leadership and Business Divisions
- [ ] Spare Parts, Mining Operations and Equipment Hire
- [ ] Equipment Sales and Installment Finance
- [ ] Equipment Catalogue and Projects
- [ ] News, announcements and media gallery
- [ ] Careers, tenders, contact, locations and FAQs
- [ ] Staff Login link
- [ ] SEO, social metadata and sitemap
- [ ] Image/video performance controls
- [ ] Responsive and accessibility acceptance

### Phase 6 gate

- [ ] Website reads only published public APIs
- [ ] Public site cannot access staff authentication or private APIs
- [ ] Existing staff login remains fully operational
- [ ] Mobile performance and accessibility acceptance pass

---

# Phase 7 — AI Security and Provider Foundation

- [ ] AI provider abstraction and failure handling
- [ ] Registered tool catalogue
- [ ] AI permission, evidence and conversation services
- [ ] Immutable AI audit, usage and cost controls
- [ ] Prompt-injection and sensitive-data protections
- [ ] AI foundation tests and emergency shutdown acceptance

### Phase 7 gate

- [ ] AI never connects directly to MySQL
- [ ] AI calls only registered backend tools
- [ ] Every tool repeats normal permission and scope checks
- [ ] AI outage does not affect ordinary Chalin 03 operation

---

# Phase 8 — AI Knowledge and Feedback

- [ ] Approved knowledge sources and versions
- [ ] Workspace, visibility, effective and expiry scope
- [ ] Retrieval with citations
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

- [ ] Action proposals and Approval Inbox
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

- [ ] Application/document completeness
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

# Final Release Acceptance

- [ ] All planned release phases completed
- [ ] No unresolved critical or high-severity defect
- [ ] Synchronize the final current `main` history into the release candidate without losing either side
- [ ] Full backend and frontend tests/builds pass
- [ ] Permission, workspace and location isolation pass
- [ ] Database migration rehearsal passes on a recent safe production copy
- [ ] Backup and restore rehearsal passes
- [ ] Desktop and mobile acceptance passes
- [ ] Public/private and AI-disabled regressions pass
- [ ] Exact release-candidate commit is frozen and recorded
- [ ] Final production backups are completed and verified
- [ ] Merge accepted `chalin-one` release into `main`
- [ ] Verify the complete integrated `main` release
- [ ] Merge the verified `main` release into `production`
- [ ] Cloudflare production deploys from `production`
- [ ] Railway production deploys from `production`
- [ ] Production smoke test and monitoring period pass
