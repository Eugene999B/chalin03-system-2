# CHALIN03 Spare Parts — Page Access Reference

## Purpose
Page access in the User Permissions screen now uses a human-readable list of **37 real Spare Parts pages**. The following is the **auditor role default**, not a claim about each individual account: per-person overrides, suspended accounts, workspace assignment and store/branch limitations still apply.

The original System Administrator has immutable owner access. Page grants cannot bypass existing server-side job-role, feature, approval, customer/branch, financial or security protections.

## Auditor — allowed by default (24)

| Page | Address |
|---|---|
| Products | `/products` |
| New Sale | `/new-sale` |
| Sales History | `/sales-history` |
| Installment Sales | `/installments` |
| Debts | `/debts` |
| Stock Transfers | `/stock-transfers` |
| Low Stock / Restock | `/low-stock` |
| Purchases | `/purchases` |
| Returns | `/returns` |
| Expenses | `/expenses` |
| Daily Closing | `/daily-closing` |
| Customer Statement | `/customer-statement` |
| Reports | `/reports` |
| Audit & Accounting | `/audit-accounting` |
| Audit Sign-Off History | `/audit-signoffs` |
| Accounting Intelligence | `/advanced-accounting-intelligence` |
| Blind Stock Count | `/stock-count` |
| Exports & Downloads | `/exports` |
| Activity Log | `/activity-log` |
| Shared Reports & Documents | `/shared-controls` |
| Worker Profiles | `/workers` |
| Notification Centre | `/notifications` |
| Change Password | `/change-password` |
| Help / User Guide | `/help` |

## Auditor — unavailable by default (13)

| Page | Address |
|---|---|
| Dashboard | `/` |
| Payroll Processing | `/payroll` |
| Employment & HR Documents | `/employment-documents` |
| SMS Centre | `/sms` |
| Audit Unlock Requests | `/audit-unlock-requests` |
| Users & Settings | `/users-settings` |
| User Permissions | `/user-permissions` |
| Backup & Restore | `/backup` |
| Professional Backups | `/professional-backups` |
| Security Centre | `/security-centre` |
| System Operations | `/system-operations` |
| Document Signature Settings | `/document-signature-settings` |
| System Maintenance | `/maintenance` |

## Important correction
The Spare Parts auditor currently has some operational **write** privileges, including sales, payments, stock-related work, and expense-related work. Do not treat the auditor as a read-only observer. Mining and Equipment Hire auditor policies are separate and must not be inferred from this list.

## How the manager works

1. Choose **Spare Parts**, then the staff user. The Page Access panel summarizes allowed and blocked pages.
2. Search or filter by business group and access status. Select **Allow**, **Block** or **Role default** on the page card.
3. Unlock protected changes using the current password, provide a reason, and leave session revocation enabled so the decision becomes effective after reauthentication.
4. Role-ineligible pages cannot be unlocked simply through a page grant. Change the underlying job role or relevant feature access only if authorized.
5. Desktop and mobile sidebars hide denied pages; direct page addresses are independently rejected in the frontend. Backend endpoint action and store-permission checks remain enforced separately. A page block is not a universal API revocation.
6. Use **Advanced permissions** when the required change is about a specific action (payment, approval, data export, user management), not merely visibility of the page.

## Release verification
Before live release, run `node --test backend/tests/sparePartsPageAccess.test.js` from repository root and `npm test` / `npm run build` under `frontend`, then inspect mobile and desktop behavior in a signed-in browser. Changes are staged in a draft PR, not yet production-deployed.
