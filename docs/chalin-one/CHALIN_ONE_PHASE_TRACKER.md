# CHALIN ONE — Implementation Phase Tracker

This tracker is the source of truth for CHALIN ONE work on the `chalin-one` branch.

## Permanent release rule

- Development and testing happen on `chalin-one`.
- Production Cloudflare and Railway remain connected to `main`.
- The final approved CHALIN ONE release is merged into `main` before production deployment.
- Production is never deployed directly from `chalin-one`.

## Status legend

- `[ ]` Not started
- `[-]` In progress
- `[x]` Completed and verified
- `[!]` Blocked

---

# Phase 0 — Branch and Governance Foundation

- [x] Create `chalin-one` from current `main`
- [x] Verify `chalin-one` and `main` initially point to the same commit
- [x] Record permanent production deployment rule
- [x] Add master architecture document
- [-] Add detailed AI permission matrix
- [ ] Add public-content permission matrix
- [ ] Add external-portal permission matrix
- [ ] Add AI tool catalogue
- [ ] Add approval and risk matrix
- [ ] Add data classification map
- [ ] Add staging environment checklist
- [ ] Add final cutover and rollback checklist

### Phase 0 gate

- [ ] All architecture and security documents agree with current workspaces and roles
- [ ] No production deployment configuration changed
- [ ] `main` remains unchanged by CHALIN ONE work

---

# Phase 1 — Feature Flag Foundation

- [ ] Add backend feature-flag configuration service
- [ ] Add protected feature-status endpoint for staff
- [ ] Add safe public feature-status endpoint with public flags only
- [ ] Add frontend feature-flag context/hook
- [ ] Hide disabled navigation and routes
- [ ] Return controlled backend errors for disabled features
- [ ] Add emergency AI-disable switch
- [ ] Add automated feature-flag tests

### Phase 1 gate

- [ ] Existing system operates normally with every CHALIN ONE flag disabled
- [ ] Disabled frontend features are not visible
- [ ] Disabled backend features cannot be invoked directly
- [ ] Feature flags cannot override workspace or permission checks

---

# Phase 2 — Public Content Database

- [ ] Design final public-content schema
- [ ] Add migration
- [ ] Add verification script
- [ ] Add page and page-version tables
- [ ] Add reusable page-section tables
- [ ] Add news and announcement tables
- [ ] Add leadership and business-division tables
- [ ] Add project and project-media tables
- [ ] Add equipment catalogue tables
- [ ] Add testimonial, location and company-statistic tables
- [ ] Add vacancy, tender and FAQ tables
- [ ] Add media-library tables
- [ ] Add public form and submission tables
- [ ] Add publishing approval and audit tables
- [ ] Add website settings and navigation tables
- [ ] Add indexes, uniqueness rules and foreign keys
- [ ] Test migration on isolated database
- [ ] Test migration on safe production copy

### Phase 2 gate

- [ ] Migration is additive and repeat-safe
- [ ] Verification reports no structural errors
- [ ] Existing production tables and totals remain unchanged
- [ ] Previous application version remains operational against the expanded schema

---

# Phase 3 — Public Content APIs

- [ ] Build published public-content service
- [ ] Build public pages endpoint
- [ ] Build news and announcement endpoints
- [ ] Build leadership and division endpoints
- [ ] Build project and equipment endpoints
- [ ] Build location, FAQ and settings endpoints
- [ ] Build public enquiry/form endpoint
- [ ] Add validation and spam controls
- [ ] Ensure draft and archived content cannot leak
- [ ] Add cache controls and pagination
- [ ] Add public API tests

### Phase 3 gate

- [ ] Anonymous users can read only published public content
- [ ] Anonymous users cannot infer draft content
- [ ] Public form submissions are validated, rate-limited and audited
- [ ] Public endpoints expose no staff or internal operational data

---

# Phase 4 — Chalin Content Studio Backend

- [ ] Add Content Studio permissions
- [ ] Add pages and section administration
- [ ] Add publishing workflow
- [ ] Add version history and restoration
- [ ] Add news and announcement administration
- [ ] Add leadership, project and equipment administration
- [ ] Add media-library upload service
- [ ] Add image compression and thumbnail generation
- [ ] Add public form-submission review tools
- [ ] Add website settings administration
- [ ] Add scheduled publishing and expiry jobs
- [ ] Add full content audit trail
- [ ] Add Content Studio backend tests

### Phase 4 gate

- [ ] Editors cannot publish without permission
- [ ] Approvers cannot bypass required review records
- [ ] Previous content versions can be restored safely
- [ ] Media replacement does not break existing pages
- [ ] Scheduled and expired content behaves correctly

---

# Phase 5 — Chalin Content Studio Frontend

- [ ] Add Content Studio dashboard
- [ ] Add page builder
- [ ] Add reusable section editor
- [ ] Add news and announcement manager
- [ ] Add leadership manager
- [ ] Add project and equipment manager
- [ ] Add media library
- [ ] Add website settings
- [ ] Add publishing Approval Inbox
- [ ] Add desktop, tablet and mobile preview
- [ ] Add version comparison and restore interface
- [ ] Add responsive desktop and mobile layouts
- [ ] Add Content Studio acceptance tests

### Phase 5 gate

- [ ] Non-programmer can update homepage content
- [ ] Non-programmer can upload and reuse media
- [ ] Editor can submit and approver can publish
- [ ] Mobile and desktop previews match public rendering
- [ ] Permissions are enforced in both frontend and backend

---

# Phase 6 — Separate Public Website

- [ ] Create `public-website` application
- [ ] Add shared design system
- [ ] Build homepage
- [ ] Build About and Company History
- [ ] Build Leadership
- [ ] Build Business Divisions
- [ ] Build Spare Parts page
- [ ] Build Mining Operations page
- [ ] Build Equipment Hire page
- [ ] Build Equipment Sales page
- [ ] Build Installment Finance page
- [ ] Build Equipment Catalogue
- [ ] Build Projects
- [ ] Build News and Announcements
- [ ] Build Media Gallery
- [ ] Build Careers
- [ ] Build Contact and Locations
- [ ] Build FAQs
- [ ] Add Staff Login link
- [ ] Add SEO and social metadata
- [ ] Add accessibility checks
- [ ] Add image and video performance controls
- [ ] Add responsive desktop and mobile acceptance

### Phase 6 gate

- [ ] Website reads only public APIs
- [ ] Content Studio changes render correctly
- [ ] Website performs acceptably on mobile connections
- [ ] Public site cannot access staff authentication or private APIs
- [ ] Existing staff login remains fully operational

---

# Phase 7 — AI Security and Provider Foundation

- [ ] Add AI provider adapter
- [ ] Add tool registry
- [ ] Add AI permission service
- [ ] Add evidence service
- [ ] Add conversation service
- [ ] Add immutable AI audit records
- [ ] Add AI usage and cost controls
- [ ] Add emergency shutdown
- [ ] Add provider timeout and failure handling
- [ ] Add prompt-injection protections
- [ ] Add maximum input and result sizes
- [ ] Add sensitive-data minimization
- [ ] Add AI foundation tests

### Phase 7 gate

- [ ] AI cannot connect directly to MySQL
- [ ] AI can call only registered backend tools
- [ ] Tool calls repeat all ordinary permission and scope checks
- [ ] AI outage does not affect normal Chalin 03 operations
- [ ] Spending and per-user usage limits work

---

# Phase 8 — AI Knowledge and Feedback

- [ ] Add knowledge-source records
- [ ] Add document versions
- [ ] Add approval workflow
- [ ] Add workspace and visibility scope
- [ ] Add effective and expiry dates
- [ ] Add document retrieval and citations
- [ ] Add answer feedback
- [ ] Add correction review
- [ ] Add knowledge administration interface
- [ ] Add knowledge security tests

### Phase 8 gate

- [ ] Bot uses only approved active knowledge
- [ ] Superseded documents are not treated as current
- [ ] Public Guide cannot retrieve internal knowledge
- [ ] Corrections require authorized review before reuse

---

# Phase 9 — Chalin Copilot Read-Only Release

- [ ] Sales summary and comparison
- [ ] Product search
- [ ] Low-stock, overstock and dead-stock analysis
- [ ] Reorder recommendation
- [ ] Store transfer recommendation
- [ ] Customer search and Customer 360
- [ ] Duplicate-customer suggestions
- [ ] Customer statement preparation
- [ ] Debt summary and risk ranking
- [ ] Debt-reminder draft
- [ ] Daily-closing explanation
- [ ] Cash-difference investigation
- [ ] Expense-anomaly review
- [ ] Audit-anomaly summary
- [ ] Approved-document search
- [ ] System-health summary
- [ ] Backup-status summary
- [ ] Notification summary
- [ ] Professional report preparation
- [ ] Floating Copilot interface
- [ ] Full intelligence workspace
- [ ] Evidence and feedback interface

### Phase 9 gate

- [ ] Every tool passes administrator, manager, cashier, accountant and auditor tests
- [ ] Every tool passes workspace and location isolation tests
- [ ] Every factual response includes scope and evidence
- [ ] Unauthorized requests are rejected by backend permissions

---

# Phase 10 — AI Approval and Controlled Actions

- [ ] Add action proposal records
- [ ] Add Approval Inbox
- [ ] Add approve, reject and request-change workflow
- [ ] Add proposal expiry
- [ ] Add before-and-after previews
- [ ] Add execution locks and idempotency
- [ ] Add approved debt reminder sending
- [ ] Add approved quotation creation
- [ ] Add approved public-content drafting
- [ ] Add approved report generation
- [ ] Add approved stock and purchase proposals
- [ ] Add controlled-action security tests

### Phase 10 gate

- [ ] AI cannot approve its own proposal
- [ ] AI cannot call final write routes without a valid approval
- [ ] Every execution is traceable to user, proposal and approval
- [ ] Repeated execution cannot duplicate business records

---

# Phase 11 — Chalin Executive

- [ ] Add executive-only permissions
- [ ] Add stronger authentication requirement
- [ ] Add private executive conversation history
- [ ] Add group-wide daily brief
- [ ] Add cash and collection overview
- [ ] Add sales, margin and expense analysis
- [ ] Add Mining, Hire and Finance comparisons
- [ ] Add risk and anomaly summary
- [ ] Add cash-flow forecast
- [ ] Add scenario simulation
- [ ] Add executive report export
- [ ] Add executive security tests

### Phase 11 gate

- [ ] Only specifically approved executives can access group-wide tools
- [ ] Non-executive users cannot infer executive totals
- [ ] Cross-business calculations reconcile with source reports
- [ ] Sensitive exports are audited

---

# Phase 12 — Chalin Guide and Public Enquiries

- [ ] Add isolated public persona
- [ ] Add public tool allowlist
- [ ] Add company information answers
- [ ] Add public equipment search
- [ ] Add quotation guidance
- [ ] Add hire enquiry guidance
- [ ] Add installment application guidance
- [ ] Add career guidance
- [ ] Add enquiry creation
- [ ] Add human handoff
- [ ] Add public rate and abuse controls
- [ ] Add public bot security tests

### Phase 12 gate

- [ ] Public bot cannot access internal tools
- [ ] Public bot cannot retrieve unpublished content
- [ ] Public conversations cannot expose private records
- [ ] Enquiries require valid consent and contact handling

---

# Phase 13 — External Portals

- [ ] Customer portal identity and verification
- [ ] Customer quotations, receipts and statements
- [ ] Customer installment schedules and document uploads
- [ ] Customer support and correction requests
- [ ] Supplier registration and profile
- [ ] Supplier quotation and document workflow
- [ ] Applicant registration and vacancy applications
- [ ] Applicant document upload and status tracking
- [ ] Portal notification and recovery flows
- [ ] Portal ownership and security tests

### Phase 13 gate

- [ ] Portal users are not staff users
- [ ] Each portal user can access only owned or explicitly shared records
- [ ] Document access and downloads are logged
- [ ] Staff permissions cannot be obtained through portal routes

---

# Phase 14 — Mining Intelligence

- [ ] Daily site summary
- [ ] Production versus target
- [ ] Fuel and machine-hour analysis
- [ ] Downtime and utilization
- [ ] Maintenance status
- [ ] Operator and shift summary
- [ ] Site comparison
- [ ] Monthly target forecast
- [ ] Incident and corrective-action summary
- [ ] Approved shift and incident report preparation
- [ ] Mining scope and accuracy tests

---

# Phase 15 — Equipment Hire Intelligence

- [ ] Equipment availability
- [ ] Booking conflict detection
- [ ] Utilization and profitability
- [ ] Contract expiration and unbilled hours
- [ ] Customer payment performance
- [ ] Quotation preparation
- [ ] Agreement and dispatch preparation
- [ ] Return inspection preparation
- [ ] Transactional availability recheck
- [ ] Hire scope and accuracy tests

---

# Phase 16 — Equipment Finance Intelligence

- [ ] Application completeness
- [ ] Missing document detection
- [ ] Installment schedule explanation
- [ ] Upcoming and overdue payment analysis
- [ ] Collection forecast
- [ ] Delivery and ownership status
- [ ] Risk indicators
- [ ] Reminder and payment-arrangement proposals
- [ ] Management review packs
- [ ] Finance decision-boundary tests

---

# Phase 17 — Voice, Vision and Advanced Intelligence

- [ ] Voice questions and transcription confirmation
- [ ] Voice incident and equipment-note preparation
- [ ] Twi support evaluation
- [ ] Spare-part image identification
- [ ] Serial and machine-hour reading
- [ ] Equipment condition comparison
- [ ] Visible-damage assistance
- [ ] GPS and geofencing integration
- [ ] Sensor and predictive-maintenance integration
- [ ] Business digital twin
- [ ] Executive AI command room

---

# Final Release Acceptance

- [ ] All planned release phases completed
- [ ] No critical or high-severity unresolved defect
- [ ] Full frontend and backend build passes
- [ ] Full permission and workspace test suite passes
- [ ] Full database migration rehearsal passes on recent safe production copy
- [ ] Full backup and restore rehearsal passes
- [ ] Desktop and mobile acceptance passes
- [ ] Public/private isolation passes
- [ ] AI disabled-mode regression passes
- [ ] Release candidate commit frozen and recorded
- [ ] Final production backup completed and verified
- [ ] Approved release merged into `main`
- [ ] Cloudflare production deployed from `main`
- [ ] Railway production deployed from `main`
- [ ] Production smoke test passes
- [ ] Monitoring period passes
