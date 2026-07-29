# Equipment Finance Final Lifecycle Production Runbook

## Purpose

This runbook activates the final controlled stages for approved-credit Equipment Installment Finance agreements:

1. installment collections and receipts;
2. equipment delivery handover; and
3. final ownership transfer.

The release does not create or modify Equipment Hire enquiries, quotations, contracts, jobs, dispatches, job cards, invoices, payments, returns or worker assignments.

Automatic installment SMS remains disabled. Successful lifecycle transactions do not send SMS.

## Non-negotiable safeguards

- Confirm a recent Professional Backup is downloaded and verified.
- Confirm a separate SQL/database backup is downloaded and verified.
- Use the Railway production database connection privately.
- Never paste database credentials into chat, GitHub issues or pull requests.
- Never run `database/schema.sql` against production.
- Run the migration as one complete file.
- Run the verifier immediately afterward.
- Do not use a destructive rollback. Corrections must be additive and forward-only.

## Required migration order

The following migrations must already be present before the final lifecycle migration:

1. `database/migrations/20260729_equipment_credit_application_foundation.sql`
2. `database/migrations/20260729_equipment_finance_agreement_activation.sql`
3. `database/migrations/20260729_equipment_finance_deposit_reservation.sql`

Then run:

4. `database/migrations/20260729_equipment_finance_final_lifecycle.sql`

Immediately run:

5. `database/migrations/20260729_equipment_finance_final_lifecycle_verify.sql`

## Expected verification results

Every result below must be exactly `0`:

- `missing_final_lifecycle_columns`
- `missing_final_lifecycle_indexes`
- `missing_final_lifecycle_foreign_keys`
- `missing_final_lifecycle_triggers`
- `bypassed_controlled_finance_payments`
- `invalid_controlled_finance_collections`
- `invalid_controlled_finance_deliveries`
- `invalid_controlled_finance_ownership_transfers`
- `uncontrolled_finance_delivery_statuses`
- `uncontrolled_finance_ownership_statuses`
- `controlled_finance_assets_active_on_hire`

Stop immediately if any count is not zero. Preserve the output and prepare an additive correction; do not delete records or drop the new controls.

## Runtime behaviour before migration

The production code is safe to deploy before SQL execution. The final lifecycle API and interface check the required columns and triggers. When they are missing, the API returns a controlled `503` readiness response and the interface prevents all lifecycle mutations.

## Controlled role ownership

### Installment collections

The following may record a collection:

- Finance Manager
- Finance Accountant
- Collections Officer
- protected original System Administrator

### Delivery and ownership

The following may record delivery handover or complete ownership transfer:

- Finance Manager
- Finance Accountant
- protected original System Administrator

Finance Auditor remains read-only. Hire staff cannot enter or mutate the Finance lifecycle.

## Post-migration smoke test

Use one controlled test application and machine at a specific Finance location.

1. Confirm a partial installment collection creates one receipt and updates only Finance schedule rows.
2. Submit the same request key again and confirm it returns the original receipt instead of duplicating money.
3. Confirm the delivery action remains blocked until the agreement's approved delivery threshold is reached.
4. Record delivery handover and confirm no Hire job, dispatch or return is created.
5. Confirm ownership transfer remains blocked while any balance remains.
6. Settle the remaining balance using the controlled collection action.
7. Complete ownership transfer and confirm the machine becomes `sold`.
8. Confirm no automatic or transaction-triggered SMS was sent.
9. Confirm a Hire Officer cannot open the Finance lifecycle.
10. Confirm the System Administrator can supervise without assigning one staff member to both divisions.

## Existing legacy agreements

Legacy Equipment Sales agreements continue through the existing legacy account workflow. The new triggers apply the strict lifecycle gates only when `activation_source = 'approved_credit_application'`.
