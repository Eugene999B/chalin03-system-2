# Equipment Finance Agreement Activation Production Runbook

## Scope

This runbook activates the approved-credit-application gate for Equipment Installment Finance agreements.

It does **not** create or alter Equipment Hire enquiries, Hire quotations, Hire contracts, dispatches, job cards, Hire invoices, Hire payments, returns or Hire workers.

It also does **not** collect a deposit, create a payment, reserve or lock a machine, change `fleet_assets.sale_status`, create delivery evidence, transfer ownership or send SMS.

## Required backups

Before running SQL against production, verify both of the following:

1. A fresh Professional Backup downloaded from the live Chalin 03 system.
2. A separate Railway MySQL SQL backup with a non-zero file size and confirmed integrity.

Do not continue if either backup is missing or unreadable. Never share Railway credentials in chat, source control, screenshots or support messages.

## Required prerequisites

The following earlier migrations must already be present:

- `20260722_equipment_sales_installments_foundation`
- `20260729_equipment_credit_application_foundation`

Confirm the required parent tables exist before applying the activation migration:

- `equipment_credit_applications`
- `equipment_credit_application_kyc`
- `equipment_sale_agreements`
- `equipment_installment_schedule`
- `equipment_sales_quotations`
- `equipment_sales_quotation_items`
- `fleet_assets`
- `hire_customers`
- `business_locations`
- `users`

## Production execution order

Run only the timestamped migration below through the secured Railway MySQL connection:

```text
database/migrations/20260729_equipment_finance_agreement_activation.sql
```

Immediately run the read-only verification:

```text
database/migrations/20260729_equipment_finance_agreement_activation_verify.sql
```

Every verification problem count must be `0`:

- `missing_activation_columns`
- `missing_activation_indexes`
- `missing_activation_foreign_keys`
- `missing_activation_triggers`
- `duplicate_credit_application_agreement_links`
- `invalid_activated_credit_applications`
- `invalid_linked_finance_agreements`
- `forbidden_hire_link_columns`
- `activation_migration_record_missing`

Stop immediately if any result is not `0`. Do not run `database/schema.sql`, destructive cleanup SQL or an ad-hoc rollback. Preserve the evidence and prepare a forward-only corrective migration.

## Authenticated readiness test

After backend deployment, sign in as the protected System Administrator, Finance Manager or Finance Accountant and open the activation readiness endpoint through the application session:

```text
GET /api/equipment-catalogue/sales/agreement-activations/readiness
```

Expected result:

- HTTP `200`
- `readiness.ready = true`
- no missing columns
- no missing triggers

A missing migration must return HTTP `503` and must not mutate the database.

## Controlled functional acceptance

Use a non-production-value test quotation and application at one Finance location.

1. Confirm the quotation is approved or accepted and contains installment terms.
2. Create and submit the Finance credit application.
3. Verify KYC.
4. Approve the application independently.
5. Sign in as Finance Manager or Finance Accountant.
6. Activate the agreement with accepted terms and a first due date that is today or later.
7. Confirm one Finance agreement and the expected number of schedule rows were created.
8. Confirm the application now points to that agreement.
9. Repeat the activation request and confirm no duplicate agreement is created.

## Mandatory separation proof

After the acceptance test, verify all of the following:

- No `hire_contracts` row was created or changed.
- No Hire dispatch, job card, Hire invoice, Hire payment or return was created or changed.
- No `equipment_sale_payments` row was created.
- No `equipment_asset_sale_locks` row was created.
- The equipment `fleet_assets.sale_status` did not change.
- The agreement has `equipment_commitment_status = 'not_reserved'`.
- No delivery or ownership-transfer row was created.
- No SMS was sent.
- The audit trail contains `EQUIPMENT_FINANCE_AGREEMENT_ACTIVATED`.

## Role acceptance

Verify the following access rules:

- Finance Manager: may activate an approved agreement.
- Finance Accountant: may activate an approved agreement.
- Credit Officer: may prepare applications but may not activate agreements.
- Collections Officer: may not activate agreements.
- Finance Auditor: read-only and may not activate agreements.
- Hire Manager, Hire Officer, Dispatcher, Fleet Officer, Hire Accountant and Hire Auditor: cannot access the activation API.
- Protected original System Administrator: may supervise and activate.

## Current release boundary

Agreement activation creates an approved Finance agreement and its installment schedule. The machine remains unreserved and available in the shared equipment register until the later controlled deposit-and-reservation release.
