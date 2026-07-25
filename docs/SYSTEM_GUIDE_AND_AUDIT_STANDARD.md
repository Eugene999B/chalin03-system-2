# Chalin 03 System Guide and Audit Standard

## Purpose

This document controls how the Chalin 03 in-app Help, repository README, Google Docs handbook and full-system score are maintained.

Documentation is not treated as decoration. It is part of production control because staff instructions, category boundaries, approval rules, backup procedures and deployment instructions can cause real business loss when they are stale.

## Current documentation baseline

- Product: Chalin 03 Group Operations Platform
- Release family: Version Three · v3.0.0
- Integration branch: `main`
- Live deployment branch: `production`
- Release flow: `agent/* → main → production`
- Recorded production baseline: `0cf526cdb50690fa70d712c958edceeb19f55e54`
- Authentication: password-only browser sign-in
- Backup: signed `chalin03-full-system-v2`
- Restore: production browser restore disabled
- Database transport: Railway private MySQL with `DB_SSL=true`

The recorded commit is historical evidence. Always verify the current live production head before a future audit.

## Documentation surfaces

### In-app Help

- Spare Parts: `frontend/src/pages/HelpPage.jsx`
- Mining: `frontend/src/pages/WorkspaceHelpPage.jsx`
- Equipment Sales & Hire: `frontend/src/pages/WorkspaceHelpPage.jsx`

### Repository

- Canonical operating manual: `README.md`
- Production release control: `docs/PRODUCTION_RELEASE_CONTROL.md`
- This documentation/audit standard

### Google Docs handbook

The handbook master index links the public/login guide, three complete workspace guides, Group Executive guide, three daily procedures, access-control guide, executive overview, architecture, GitHub/release, deployment, backup, security, hosting, database, public web, SMS, workforce, testing, training, roadmap and handover documents.

## Mandatory content rules

1. Spare Parts must not teach creation of new installment sales.
2. Equipment installments must be documented only under Equipment Sales & Hire.
3. Mining sites, Hire locations and Spare Parts stores must remain distinct.
4. `main` must be documented as integration, not the live deployment branch.
5. `production` must be documented as the only automatic deployment branch.
6. Passkeys/biometric browser sign-in must not be presented as active.
7. Signed Version 2 backup and fail-closed restore rules must be documented.
8. Protected boss-signature snapshots must be distinguished from the current saved signature.
9. Financial and approval instructions must preserve original evidence and independent review.
10. Old commits may remain as history but must not be labelled current production.

## Update workflow

For each approved release:

1. identify affected pages and business categories;
2. update the relevant in-app Help section;
3. update README when architecture or operating rules change;
4. update affected Google Docs handbook entries;
5. update tests that detect retired or contradictory instructions;
6. run frontend tests, lint and build;
7. run backend and security gates when code or configuration changed;
8. record the release in the handbook update register;
9. verify the documentation after production deployment.

## Audit scoring model

| Area | Weight |
|---|---:|
| Production safety, migrations and disaster recovery | 15 |
| Authentication, sessions and shared security | 12 |
| Permissions, category and location isolation | 12 |
| Monetary correctness and approvals | 14 |
| Spare Parts correctness | 10 |
| Mining correctness | 10 |
| Equipment Sales & Hire correctness | 12 |
| Reports, documents, workforce and audit evidence | 7 |
| Mobile, usability and accessibility | 4 |
| Testing, deployment and documentation | 4 |
| **Total** | **100** |

### Evidence scale

- **Full marks:** current automated and manual evidence directly verifies the requirement.
- **Minor deduction:** control exists but documentation, edge-case coverage or acceptance evidence is incomplete.
- **Material deduction:** a meaningful correctness, authorization, recovery or usability risk remains.
- **Zero for an item:** control is absent, contradicted by active behavior or cannot be evidenced.

### Severity scale

- **Critical:** credible data-loss, unauthorized control, financial corruption or full production outage risk.
- **High:** major category isolation, permission, accounting, recovery or core-workflow defect.
- **Medium:** incorrect edge case, incomplete evidence, document/report error or significant usability problem.
- **Low:** minor usability, wording, consistency or maintainability gap with limited operational impact.

## Required full-system audit evidence

- current repository and route map;
- backend syntax and complete tests;
- frontend source tests, lint and production build;
- dependency audit and CodeQL;
- full-history secret scan;
- migration-safety and recovery evidence;
- production startup configuration review;
- role/permission and category isolation review;
- financial formula and approval review;
- Spare Parts workflow review;
- Mining workflow review;
- Equipment Sales & Hire workflow review;
- reports, PDF, exports, workforce and signature review;
- desktop/mobile acceptance evidence;
- current handbook and README consistency review.

## Audit output

The audit report must contain:

1. executive score and confidence level;
2. score by weighted area;
3. verified strengths;
4. findings with severity and evidence;
5. remediation priority;
6. items not fully verified;
7. recommended next phase;
8. explicit statement that no score proves the future absence of defects.
