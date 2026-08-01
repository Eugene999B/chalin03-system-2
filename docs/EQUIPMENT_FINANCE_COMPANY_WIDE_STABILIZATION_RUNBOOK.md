# Equipment Finance Company-Wide Stabilization Runbook

Release date: 1 August 2026

Main migration record:

`20260801_equipment_finance_company_wide_stabilization`

Database-guard correction record:

`20260801_equipment_finance_company_wide_trigger_correction`

## Purpose

This release repairs Equipment Installment Finance after production exposed the following problems:

- Start New Installment could return HTTP 500 when the selected excavator had no Hire location.
- Finance claimed to be company-wide while applications, agreements, payments and documents still depended on Hire locations internally.
- Customer KYC, employment, income, consent and guarantor details blocked creation of a basic draft.
- Custom frequency did not produce a genuine custom-day schedule.
- Agreement activation could change the first due date after approval.
- Legacy collection, delivery and ownership paths continued writing Hire locations.
- Delivery and ownership asked staff to paste external evidence URLs.
- Old Finance bookmarks could open Equipment Hire pages.

## Production boundary

The release is forward-only and additive.

It does not:

- reset the database
- delete applications, agreements, schedules, payments, documents or audit events
- clear Hire locations from Equipment Hire enquiries, quotations, contracts, jobs, dispatches or operational records
- rewrite original payment allocations or issued documents
- create a Hire enquiry, Hire contract or Hire job

## Company-wide normalization

Only records linked to Equipment Installment Finance are normalized to `hire_location_id = NULL`:

- `equipment_credit_applications`
- `equipment_sales_quotations` linked to a credit application
- `equipment_sales_quotation_items` linked to those quotations
- approved-credit `equipment_sale_agreements`
- sale locks linked to those agreements
- payments linked to those agreements
- deliveries linked to those agreements
- ownership transfers linked to those agreements
- reminder evidence linked to those agreements

All corresponding columns become nullable while their foreign keys remain in place for legacy Hire records.

## Safety snapshot

Before the main migration runs, the controlled runner:

1. verifies the exact Railway database identity
2. verifies the previously deployed Phase 3 migration
3. acquires a MySQL advisory lock
4. creates release-specific database-side snapshots of every affected table
5. verifies exact source and snapshot row counts
6. records the ready snapshot manifest
7. records preserved row counts
8. runs only the approved migration
9. confirms every preserved row count is unchanged
10. runs the read-only verifier

The signed Chalin 03 website backup remains the external recovery copy. Railway Hobby does not provide a separate managed SQL backup.

## Required main verifier results

Every result must be zero:

```text
missing_finance_stabilization_columns=0
non_nullable_finance_location_columns=0
finance_records_with_hire_location=0
invalid_finance_interval_terms=0
invalid_company_wide_agreement_intervals=0
finance_stabilization_migration_record_missing=0
```

## Database-guard verification

After the main migration, Railway replaces and verifies these Finance triggers:

- `trg_equipment_finance_payment_gate_before_insert`
- `trg_equipment_finance_reservation_gate_before_insert`
- `trg_equipment_finance_commitment_gate_before_update`
- `trg_equipment_finance_delivery_gate_before_insert`
- `trg_equipment_finance_ownership_gate_before_insert`

Each corrected trigger:

- forces new Finance evidence to `hire_location_id = NULL`
- identifies the case by agreement, application, customer and exact asset
- retains idempotency protection
- retains independent application approval requirements
- retains the full-deposit reservation gate
- retains the active-Hire machine gate
- retains delivery threshold and settlement gates
- contains no `NEW.hire_location_id` comparison

Railway does not start the API if a trigger is missing, still compares a Hire location, or fails verification.

## Exact schedule rules

The same schedule service is used by the wizard, affordability assessment, application review and agreement activation.

Supported patterns:

- every 7 days
- every 14 days
- monthly on the selected collection day
- custom interval from 1 to 365 days

The worker chooses:

- selling price
- opening deposit
- number of payments
- first due date
- interval
- weekend rule: exact date, next weekday or previous weekday

The system previews every due date and adjusts the final payment by cents so the schedule total equals the financed amount exactly.

Approved dates cannot be changed during activation. A later change requires a controlled numbered amendment.

## Draft and approval rules

Draft creation requires:

- an existing customer or new customer name and phone
- the exact sale-ready excavator
- valid price, deposit and payment terms

Draft creation does not require:

- Ghana Card or other ID details
- residential address
- employment type or occupation
- salary or business income
- consent
- guarantor

Those items are completed before submission and approval. The submission endpoint blocks incomplete KYC or missing positive affordability income. Approval also requires verified KYC and an eligible or manual-review assessment.

The person who created or submitted the application cannot independently review it. The protected original System Administrator retains emergency owner authority.

## Secure lifecycle evidence

Delivery requires verified private case documents for:

- customer or buyer signature
- delivery note or signed handover

Ownership transfer requires a verified private case document for:

- ownership document
- ownership transfer
- registration transfer

Staff select the verified document from the case. They do not paste an external URL.

## GitHub release gates

Before merge to `main` and again before merge to `production`, require:

- backend syntax check
- complete backend test suite
- frontend source contracts
- full frontend lint
- production frontend build
- migration-safety contracts
- backend and frontend dependency audit
- full-history secret scan
- document-signature verification
- CodeQL security analysis

Merge only the exact reviewed head.

## Production smoke test

After Railway reports the production commit successful:

1. Sign out completely and sign back in as the original System Administrator.
2. Confirm every Spare Parts and owner-only page remains available.
3. Open Start New Installment with an excavator that has no Hire location.
4. Select customer and excavator, choose a custom 10-day interval and review all exact dates.
5. Leave income, occupation and guarantor blank and create the draft.
6. Confirm the application opens automatically without HTTP 500.
7. Confirm submission is blocked until required KYC, consent and affordability are complete.
8. Confirm another authorised reviewer can open the complete file and the creator cannot approve their own case.
9. Confirm activation displays the approved schedule read-only.
10. Record a harmless test only in an approved non-production test case; do not create live financial evidence merely for smoke testing.
11. Confirm deposit candidates, active accounts, arrears and reports load without a location selector.
12. Confirm delivery and ownership show verified protected document selectors rather than URL fields.
13. Confirm old Finance customer/catalogue/document bookmarks redirect into Finance rather than Equipment Hire.
14. Confirm Equipment Hire locations, contracts and jobs still load normally.
15. Confirm Mining and Spare Parts still load normally.

## Failure handling

If Railway does not become healthy:

- do not run the full schema
- do not drop the new columns or snapshot tables
- do not restore over live production blindly
- preserve the exact Railway error
- leave the previous deployment active
- prepare a reviewed forward-only corrective PR

The migration runners are idempotent. A later deployment verifies completed records instead of repeating a successful migration.
