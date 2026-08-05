# CHALIN ONE — Master Architecture and Release Rules

## 1. Purpose

CHALIN ONE expands the existing Chalin 03 business operating system into four connected products:

1. **Chalin Public Website** — the public corporate website at `www.chalin03.com` / `chalin03.com`.
2. **Chalin Content Studio** — the protected staff area for updating public pages, news, media, equipment, projects, leadership and website settings without programming.
3. **Chalin Intelligence** — one secure intelligence engine exposed as Chalin Guide, Chalin Copilot and Chalin Executive.
4. **External Portals** — customer, supplier and applicant portals separated from staff accounts.

The project extends the existing Spare Parts, Mining Operations, Equipment Hire, Equipment Finance, Group Executive, HR, document, SMS, notification, backup, audit and permission systems. Existing production workflows must continue to work when every new feature is disabled.

---

## 2. Permanent Git and Deployment Rule

### Branches

- `main` is the protected production source branch.
- `chalin-one` is the complete CHALIN ONE development branch.
- All CHALIN ONE development, migrations, tests and documentation are created on `chalin-one`.
- CHALIN ONE code must not be partially merged into `main`.

### Production deployment sequence

The only permitted production sequence is:

1. Build and test CHALIN ONE on `chalin-one`.
2. Complete local and staging acceptance.
3. Freeze an exact release candidate commit.
4. Take and verify the production backup.
5. Merge the approved release candidate into `main`.
6. Deploy Cloudflare production from `main`.
7. Deploy Railway production from `main`.
8. Run production smoke tests.
9. Roll back to the previous verified `main` deployment if a release-blocking defect appears.

**Cloudflare and Railway production must never deploy directly from `chalin-one`.**

---

## 3. Environment Model

### Production

- Git source: `main`
- Public website: `chalin03.com` and `www.chalin03.com`
- Staff application: `staff.chalin03.com` when domain separation is released
- External portals: `portal.chalin03.com` when released
- Backend API: `api.chalin03.com`
- Database: Railway production MySQL

### Development and staging

- Git source: `chalin-one`
- Local frontend and backend for ordinary implementation
- Separate staging frontend and backend when remote acceptance begins
- Separate staging MySQL database copied safely from production when realistic data is required
- Test SMS, WhatsApp and AI provider modes only

The `chalin-one` branch must never use production database credentials during ordinary development or staging tests.

---

## 4. Product Boundaries

### 4.1 Public Website

The public website may read only published public content. It must not contain staff authentication state, internal customer data, sales, debts, profit, audit information, private equipment records or internal documents.

### 4.2 Staff Application

The existing staff system remains the operational system of record. New Content Studio and intelligence pages are added behind authentication, workspace boundaries, role checks and explicit permissions.

### 4.3 External Portals

Customer, supplier and applicant portal accounts are not staff accounts. Portal users may access only records explicitly owned by or shared with their portal identity.

### 4.4 Intelligence Personas

One intelligence engine exposes three isolated personas:

- **Chalin Guide** — public knowledge and public enquiry tools only.
- **Chalin Copilot** — staff tools constrained by workspace, role, branch, mining site, hire location and permissions.
- **Chalin Executive** — private group-wide tools available only to specially approved executive users.

The personas must have separate tool allowlists. Public tools and internal tools must never be loaded into the same unrestricted execution context.

---

## 5. Security Principles

1. The AI model never connects directly to MySQL.
2. Every AI capability is a controlled backend tool.
3. Every tool repeats authentication, workspace, location and permission checks.
4. Tool inputs are validated and output size is limited.
5. Sensitive results are minimized to what the requesting user may see.
6. Every tool call is audited.
7. Serious actions require human approval.
8. The AI cannot approve its own proposal.
9. Normal Chalin 03 operations must continue when all AI features are disabled.
10. Public website failure must not prevent staff operations.
11. Staff application failure must not expose private data through public routes.
12. Content drafts and unpublished records must never be returned by public APIs.

---

## 6. AI Action Risk Levels

| Level | Authority | Examples |
|---|---|---|
| 1 | Read | Sales summary, product search, statement explanation |
| 2 | Recommend | Reorder quantity, stock transfer recommendation, collection priority |
| 3 | Prepare | Draft quotation, reminder, report or announcement |
| 4 | Execute approved low-risk action | Send an already approved message or publish approved scheduled content |
| 5 | Explicit approval required | Merge customers, alter prices, transfer stock, modify records, release equipment |

The AI must never silently delete transactions, alter finalized sales, change debt balances, merge customers, approve finance applications, change user permissions, restore a database, create or deactivate administrators, send mass communications, modify audit sign-offs, make payments or release equipment.

---

## 7. Feature Flags

Every major area must be independently switchable through server-controlled feature flags.

Initial flags:

```env
FEATURE_PUBLIC_WEBSITE=false
FEATURE_CONTENT_STUDIO=false
FEATURE_CHALIN_COPILOT=false
FEATURE_CHALIN_EXECUTIVE=false
FEATURE_CHALIN_GUIDE=false
FEATURE_CUSTOMER_PORTAL=false
FEATURE_SUPPLIER_PORTAL=false
FEATURE_APPLICANT_PORTAL=false
FEATURE_AI_ACTIONS=false
FEATURE_AI_SCHEDULED_JOBS=false
```

Rules:

- Disabled backend features must return a controlled feature-disabled response.
- Disabled frontend features must not appear in navigation.
- Disabling AI must not disable any ordinary Chalin 03 page or API.
- Production defaults remain disabled until the corresponding acceptance gate passes.

---

## 8. New Backend Areas

Planned structure:

```text
backend/
  routes/
    publicContentRoutes.js
    contentStudioRoutes.js
    publicPortalRoutes.js
    aiRoutes.js
    aiApprovalRoutes.js
    aiKnowledgeRoutes.js
    aiAdministrationRoutes.js

  services/
    publicContentService.js
    contentPublishingService.js
    mediaLibraryService.js
    aiOrchestratorService.js
    aiProviderService.js
    aiToolRegistry.js
    aiPermissionService.js
    aiApprovalService.js
    aiAuditService.js
    aiKnowledgeService.js
    aiConversationService.js
    aiEvidenceService.js
    aiSafetyService.js
    aiCostControlService.js

  ai-tools/
    customerTools.js
    sparePartsTools.js
    debtTools.js
    inventoryTools.js
    accountingTools.js
    miningTools.js
    equipmentHireTools.js
    installmentTools.js
    humanResourcesTools.js
    systemTools.js
```

Existing route and service conventions should be preserved. New code must use the current database wrapper, authentication middleware, permission middleware, workspace boundaries, error handling, request context and audit services instead of creating parallel security systems.

---

## 9. New Frontend Areas

### Public application

A separate public frontend will be created rather than converting the staff login application into a mixed public/private application.

```text
public-website/
  src/
    components/
    layouts/
    pages/
    sections/
    services/
    hooks/
    assets/
    styles/
```

### Staff application additions

```text
frontend/src/
  ai/
    ChalinCopilot.jsx
    ExecutiveIntelligence.jsx
    AiApprovalInbox.jsx
    AiConversationHistory.jsx
    AiKnowledgeManager.jsx

  pages/
    ContentStudioPage.jsx
    WebsitePagesManager.jsx
    NewsManagerPage.jsx
    MediaLibraryPage.jsx
    PublicFormsManagerPage.jsx
```

All interfaces must support desktop and mobile layouts and preserve the independent navigation of Spare Parts, Mining Operations, Equipment Hire, Equipment Finance and Group Executive workspaces.

---

## 10. Content Studio Model

Content Studio will manage:

- Pages and reusable page sections
- Navigation and footer
- News and announcements
- Leadership profiles
- Business divisions
- Projects and galleries
- Equipment catalogue
- Testimonials
- Locations and contact details
- Company statistics
- Careers and vacancies
- Tenders
- Frequently asked questions
- Public forms and submissions
- Media and documents
- Search metadata and sharing images
- Emergency banner and maintenance notice

Publishing states:

1. Draft
2. Submitted for review
3. Approved
4. Scheduled
5. Published
6. Expired
7. Archived

Every editable public record must have version history and an audit trail. Public routes return only currently published records.

---

## 11. AI Knowledge Model

The first intelligence release uses approved knowledge retrieval and controlled tools, not unrestricted database access or immediate model fine-tuning.

Knowledge sources may include:

- Company policies
- User manuals
- Product catalogues
- Equipment specifications
- Pricing rules
- Mining procedures
- Hire procedures
- Installment rules
- HR and safety policies
- Frequently asked questions
- Company history
- Approved public website content

Every source requires ownership, workspace visibility, approval status, effective date, version and optional expiry date.

---

## 12. First Reliable AI Tool Set

The first release should contain a limited number of highly reliable read-only or draft-only tools:

- Sales summary and comparison
- Product search
- Low-stock, overstock and dead-stock analysis
- Reorder and transfer recommendations
- Customer search and Customer 360
- Duplicate-customer suggestions
- Customer statement preparation
- Debt summary and risk ranking
- Debt-reminder draft
- Daily-closing explanation
- Cash-difference investigation
- Expense-anomaly review
- Mining daily brief and site comparison
- Equipment availability and utilization
- Hire quotation draft
- Installment collection summary and upcoming-payment alerts
- Executive morning brief
- Audit-anomaly summary
- Approved-document search
- System-health, backup and notification summaries
- Professional report preparation

Write actions are added only after the approval framework passes security testing.

---

## 13. Database Migration Rules

Every migration must be:

- Additive wherever possible
- Idempotent or protected against accidental repeat execution
- Transactional where supported
- Explicitly logged
- Accompanied by verification queries or a verification script
- Tested on an isolated database
- Tested on a recent safe copy of production before release
- Backward-compatible with the previous production application during the initial release window

The first CHALIN ONE production release must not depend on destructive table or column removal.

---

## 14. Testing Gates

No phase is complete until it passes:

- Backend syntax checks
- Frontend source checks and production build
- Automated unit and permission tests
- Database migration and verification tests
- Desktop browser acceptance
- Mobile browser acceptance
- Workspace isolation tests
- Branch, mining-site and hire-location scope tests
- Unauthorized-access tests
- Audit-log verification
- Existing Spare Parts regression
- Existing Mining regression
- Existing Equipment Hire regression
- Existing Equipment Finance regression
- Backup availability and restore verification where the phase affects data

AI tools additionally require evidence accuracy tests, prompt-injection tests, output-size limits, provider-failure tests and cost-control tests.

---

## 15. Release Gates

### Gate A — Foundation

- Architecture and permission documents approved
- Feature flags implemented
- Staging environment isolated
- Migration framework verified

### Gate B — Public Platform

- Content schema and APIs complete
- Content Studio complete
- Public website complete
- Public/private data separation verified

### Gate C — Intelligence Foundation

- Provider adapter, tool registry, permissions, evidence, audit, approvals and cost controls complete
- AI-disabled operation verified

### Gate D — Copilot

- Read-only tools pass role and workspace tests
- Draft actions pass approval tests

### Gate E — Executive

- Group-wide access limited to approved executives
- Cross-business calculations verified

### Gate F — Guide and Portals

- Public tool allowlist verified
- Portal ownership isolation verified

### Gate G — Final Production Release

- All planned features complete
- Release candidate frozen
- Production-copy migration test successful
- Complete regression and security acceptance successful
- Backup and rollback procedure verified
- Approved release merged into `main`
- Cloudflare and Railway production deployed from `main`

---

## 16. Immediate Build Order

1. Establish this architecture and release rule on `chalin-one`.
2. Create the phase tracker and detailed permission matrix.
3. Implement the feature-flag service and protected feature-status endpoint.
4. Design and migrate the public-content schema.
5. Build public-content read APIs.
6. Build Content Studio administration APIs and permissions.
7. Build the Content Studio frontend.
8. Build the separate public website.
9. Build the secure AI foundation.
10. Add Chalin Copilot, Chalin Executive, Chalin Guide and external portals in gated releases.

---

## 17. Definition of Success

CHALIN ONE is successful only when:

- Existing business operations remain reliable.
- Public information can be updated without programming.
- Public and private data are structurally separated.
- Every AI answer can identify its evidence and scope.
- Every serious AI action requires the correct human approval.
- Every action is auditable.
- AI outages cannot stop normal business operations.
- The exact tested release is merged into `main` before Cloudflare and Railway production deployment.
