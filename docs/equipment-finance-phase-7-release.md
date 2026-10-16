# Equipment Installment Finance Phase 7

## Scope

This release is limited to Equipment Installment Finance. It does not change Spare Parts, Mining Operations, or normal Equipment Hire business behaviour. The only shared Equipment Sales change fences approved-credit Finance agreements away from legacy payment, delivery, ownership-transfer, and customer-message writes.

## Confirmed lifecycle defects repaired

- Introduces one evidence-based Finance reconciliation authority for approved-credit installment agreements.
- Reconciles stored agreement values against active receipts, deposit evidence, installment allocations, active schedule rows, late and waived charges, and Finance ledger debits and credits.
- Excludes rescheduled schedule lines from collections, arrears, reminders, cash-flow expectations, and next-due calculations.
- Blocks critical financial or completion mutations when receipts, allocations, schedule values, and ledger evidence conflict.
- Re-reads the authoritative post-trigger agreement after controlled balance updates.
- Restricts dashboards, cash-flow reports, receipts, statements, alerts, and exports to approved-credit Installment Finance records.
- Requires real, non-voided post-promise payments before a promise to pay can be marked kept.
- Removes silent 500-record truncation from the resilient Finance read model, arrears, corrections, and customer portfolio paths.
- Uses batched portfolio reconciliation for Finance dashboard and lifecycle list totals.
- Keeps lifecycle list responses lean and excludes full machine image data.
- Corrects Finance audit workspace evidence to `equipment_installment_finance`.
- Makes company-wide exports tolerate agreements with no Equipment Hire origin location.
- Exposes reconciliation warnings to Collections, Case Operations, lifecycle actions, statements, and portfolio reports.
- Prevents approved-credit Finance agreements from using legacy Equipment Sales payment, delivery, ownership-transfer, or SMS writes.
- Fixes the Windows path construction in the password-change session test.

## Data safety

- No destructive migration.
- No table reset, truncation, or deletion.
- No existing application, agreement, payment, schedule, document, or machine record is removed.
- Stored summary-column drift is repaired only from existing receipt, allocation, schedule, and ledger evidence inside controlled transactions.
- Critical evidence conflicts fail closed instead of guessing or overwriting financial history.

## Validation

The Phase 7 branch includes source contracts covering:

- canonical reconciliation and balance equation;
- approved-credit Finance scope;
- fail-closed mutations and post-trigger re-reading;
- rescheduled-line exclusion;
- payment-backed promises to pay;
- Finance-only audit evidence;
- company-wide exports;
- official-document reconciliation;
- governed rescheduling/default handling;
- frontend warnings and blocked actions;
- removal of silent 500-record truncation;
- batched lean portfolio reconciliation;
- legacy Equipment Sales write fencing.

The complete permanent GitHub verification, security, migration-safety, and Finance browser workflows must pass before merge to `main`, followed by a separate verified promotion from `main` to `production` and confirmation that Railway deployed the exact production commit.
