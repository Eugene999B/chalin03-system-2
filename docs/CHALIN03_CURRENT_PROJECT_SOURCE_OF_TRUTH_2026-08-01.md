# Chalin 03 — Current Project Source of Truth

**Date:** 1 August 2026  
**Owner / prepared for:** Eugene Amankwah Appiah  
**Repository:** `Eugene999B/chalin03-system-2`

This document is the authoritative continuation brief for future ChatGPT or Codex work. Do not restart old work or rely on older handoff documents when this file provides a newer status.

## 1. Live platform

Chalin 03 is a live production Group Operations Platform used for real business operations.

Public services:

- Frontend: `https://chalin03.com`
- Alternate frontend: `https://www.chalin03.com`
- API: `https://api.chalin03.com/api`
- Hosting: Cloudflare Pages frontend, Railway backend and Railway MySQL

The live business began using the system operationally on 11 July 2026. Every future change must therefore protect production records and use small, reviewed, forward-only releases.

## 2. GitHub and deployment rules

- `main` is the integrated and fully tested development/release-candidate branch.
- `production` is the live Railway production branch.
- Normal release path: feature branch → pull request to `main` → all checks pass → merge to `main` → release pull request from `main` to `production` → all production gates pass → merge to `production`.
- Do not deploy feature work directly to `production` except an isolated emergency hotfix that is later reconciled back into `main`.
- Eugene does not want local computer, PowerShell, Git CLI or Railway CLI instructions for production releases.
- Production work must be performed through GitHub and Railway automatic deployment.
- Never claim direct Railway database or log verification unless actual evidence is available.

## 3. Current production release

Equipment Installment Finance Phase 3 was promoted to production through PR #189.

- Production merge commit: `7a4b910c0945d3275a1b430519c579f06309870f`
- Exact reviewed `main` release head: `3c99b1ccbc9bd67a9a113679eff1828fa065afa3`
- GitHub/Railway deployment status: successful

Important supporting pull requests:

- PR #177 — Professional Equipment Installment Finance rebuild
- PR #188 — Phase 3 operational polish implementation
- PR #190 — emergency production fix restoring full original System Administrator access
- PR #191 — permanent owner-access correction in `main`
- PR #193 — GitHub-only fail-closed Railway Phase 3 startup migration gate
- PR #195 — production hotfix ancestry reconciled back into `main`
- PR #196 — replaced unavailable Railway Hobby SQL backup requirement with verified database-side safety snapshots
- PR #189 — production release of Phase 3

## 4. Business workspaces and separation

The system contains independent business workspaces:

1. **Spare Parts**
2. **Mining Operations**
3. **Equipment Hire**
4. **Equipment Installment Finance**, presented as the Finance division of the equipment business while remaining operationally isolated from Hire

Separation rules:

- Spare Parts uses only its two stores at Dunkwa Police Barrier.
- Mining uses administrator-created mining sites.
- Equipment Hire uses administrator-created hire locations.
- Equipment Finance is company-wide and must not require a Spare Parts store or Hire location selector.
- Each workspace keeps its own sidebar, routes, permissions, records, reports and context.
- Hire and Finance may share the equipment catalogue and customer identity system, but their operational permissions and workflows remain separate.

## 5. Administrator and permission rules

The original System Administrator is the protected owner account.

The protected owner must always retain:

- every Spare Parts page and operation
- Backup & Restore
- Security Centre
- System Operations
- User and Permission administration
- Group Executive controls
- Mining, Hire, Fleet and Finance owner-level access

Owner protections now enforced:

- owner permissions are not filtered by the active workspace catalogue
- permission override storage is not consulted for the owner
- no Allow or Deny override can be created for the owner
- stale session permission lists cannot block protected routes

Ordinary administrators remain category-scoped and permission-controlled. Cashiers and ordinary workspace staff must never inherit owner-level or cross-category authority.

## 6. Equipment Installment Finance — completed capabilities

The professional rebuild and Phase 3 now provide:

- excavator/equipment register with complete identity and photographs
- reusable customer records
- customer KYC and Ghana Card evidence
- guarantor evidence
- affordability assessment and consent controls
- credit review and approval boundaries
- configurable finance settings
- controlled agreement activation
- deposit collection and reservation rules
- professional PDF and Word agreement packs
- document signatures and issued-document evidence
- weekly, fortnightly and monthly schedules
- partial, exact-period and advance/above-period payment allocation
- immutable payment allocations and improved 80 mm thermal receipts
- post-commit boss SMS alert evidence and controlled retry
- arrears, reminders, portfolio risk and aging
- delivery and ownership-transfer controls
- secure private PDF/JPEG/PNG/WebP case documents
- 8 MB upload limit, magic-byte validation and SHA-256 checksums
- server-backed draft autosave and version-conflict handling
- task and approval inbox
- complete case chronology
- data-quality and missing-document alerts
- deterministic schedule simulation that does not mutate live balances
- numbered amendments and controlled variations that preserve original evidence
- SMS, WhatsApp link, email, copy, print and download sharing evidence
- dual Hire + Finance role templates without collapsing the divisions
- resilient account read models and corrected lifecycle raw-500 errors

## 7. Phase 3 production migration safety

Release identity:

`20260731_EQUIPMENT_FINANCE_OPERATIONAL_POLISH`

Migration record:

`20260731_equipment_finance_operational_polish`

Railway starts the Phase 3 gate before accepting API traffic.

When the migration record is absent, the gate:

- requires `NODE_ENV=production`
- requires `CHALIN03_EQUIPMENT_FINANCE_OPERATIONAL_POLISH_ENABLED=true`
- requires the confirmed fresh signed Chalin 03 website backup
- requires the exact release identity
- verifies `CHALIN03_EXPECTED_DATABASE`
- acquires a MySQL advisory lock
- creates and verifies database-side safety snapshots
- runs only the approved additive migration
- confirms preserved row counts before and after migration
- requires all seven verifier results to equal zero
- fails the deployment before API startup on any problem

After the migration record exists, later deployments perform read-only verification and do not rerun the migration.

## 8. Backup policy for the Railway Hobby plan

Eugene has a fresh signed Chalin 03 Professional Backup downloaded from the live website.

Railway Hobby does not provide the separate managed SQL backup available on higher plans. Therefore:

- do not keep asking Eugene for a Railway SQL backup while the project remains on the Hobby plan
- do not treat `CHALIN03_SQL_BACKUP_CONFIRMED` as a required gate
- use the signed website backup plus the automatic verified database-side snapshot
- retain GitHub history and forward-only migration evidence

The Phase 3 runner snapshots these preserved tables before applying migration SQL:

- `equipment_credit_applications`
- `equipment_sale_agreements`
- `equipment_sale_payments`
- `equipment_finance_issued_documents`
- `equipment_finance_payment_alerts`

Snapshot manifest:

`chalin03_phase3_finance_safety_snapshots`

Do not use destructive rollback, production reset scripts, `TRUNCATE`, `DROP DATABASE`, or schema replacement. Correct problems with reviewed forward-only fixes.

## 9. Spare Parts status

Spare Parts remains the live original business module and includes:

- products and stock
- purchases and supplier payments
- sales, cash/credit/mixed payments and receipts
- customers and consolidated debt desk
- debt payments, reminders and statements
- returns and controlled refunds
- expenses and funding treatment
- Daily Closing and independent verification
- accounting, reports and exports
- SMS Centre
- staff, permissions, audit, backup and security controls

Do not redesign or disturb Spare Parts while working on another workspace unless a shared change genuinely affects it. Always regression-test Spare Parts after shared authentication, permissions, database, reports or layout changes.

## 10. Mining and Equipment Hire status

Mining and Equipment Hire are functionally complete for normal business use.

Mining includes sites, daily logs, production, equipment, fuel, expenses, incidents, stockpiles, dispatch, contractors, crews, closing, reports, documents, workers, notifications and administration.

Equipment Hire includes customers, enquiries, availability, quotations, contracts, operations, finance, returns, reports, fleet, documents, workers and administration.

Remaining work in these modules is mainly controlled improvements, performance optimisation and real-business feedback—not a missing core workflow.

## 11. SMS and communications

The SMS provider is Arkesel.

- Sender ID: `CHALIN03`
- The Arkesel key has already been rotated; do not mention or reopen that subject unless a new provider/security issue requires it.
- SMS records must distinguish provider acceptance from confirmed delivery.
- Receipt, debt reminder, low-stock, daily closing and Finance alert evidence must remain auditable.
- WhatsApp receipt delivery through an official API remains a later integration; current Finance sharing may provide controlled WhatsApp links and evidence.

## 12. Production safety rules

For every future release:

- treat Railway MySQL as live production data
- use additive migrations with read-only verifiers
- take the available signed website backup before risky data/schema work
- use database-side snapshots when a managed Railway backup is unavailable
- preserve row counts and immutable financial/audit evidence
- keep workspace, store, site and location isolation
- test original owner, ordinary administrator and restricted staff accounts separately
- run backend syntax/tests, frontend tests, full lint, production build, dependency audit, secret scan and CodeQL
- merge only the exact reviewed head SHA
- verify Railway/Cloudflare deployment status and then smoke-test the live system
- never invent success when Railway logs or database evidence are unavailable

## 13. Eugene's working preferences

- Explain clearly and in beginner-friendly language.
- Perform GitHub actions directly when tools are available; do not send unnecessary computer commands.
- Provide exact branch, PR and commit status.
- Do not restart completed work.
- Use the latest handoff/source-of-truth file as the continuation point.
- Make small controlled production changes.
- Protect data first.
- Keep modules professional, mobile-friendly, engaging and suitable for presentation to management.
- When code cannot be changed directly, request the full file and provide a complete replacement rather than fragmented patches.

## 14. Immediate post-release checks

The next live checks are:

1. Sign out and sign back in as the original System Administrator.
2. Confirm all Spare Parts pages and owner-only pages are visible.
3. Open Equipment Installment Finance Task & Approval Inbox.
4. Confirm Finance cases, drafts, chronology and receipts load without raw SQL errors.
5. Confirm Mining and Equipment Hire still load normally.
6. Retain the downloaded signed website backup.
7. Temporary Phase 3 release variables may be removed later; they are no longer needed once the migration record exists.

Future work must start by reading this file and checking the current `main`, `production`, open pull requests and live deployment status before making changes.
