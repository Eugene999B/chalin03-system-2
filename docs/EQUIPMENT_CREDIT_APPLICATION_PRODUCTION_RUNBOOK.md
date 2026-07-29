# Equipment Credit Application Production Runbook

## Scope

This runbook activates the additive Equipment Installment Finance credit-application, KYC, affordability and decision-history foundation.

It applies only:

- `database/migrations/20260729_equipment_credit_application_foundation.sql`
- `database/migrations/20260729_equipment_credit_application_foundation_verify.sql`

It must never run `database/schema.sql` against Railway production.

The migration does not create or change an installment agreement, payment schedule, payment, Hire contract, equipment lock, delivery record, ownership transfer or SMS setting.

## Release boundary

The application and API may be deployed before this migration. Until the migration is applied, the Finance interface must show **Credit applications are not active in this database yet** and must not allow application changes.

An approved credit application remains a credit decision only. Agreement activation is a later, separately reviewed release.

## Required people

The production migration must be performed by an authorised administrator with access to:

- the Chalin 03 Professional Backup page;
- a separate Railway MySQL SQL backup method;
- the reviewed repository migration files;
- the correct production database credentials through an approved secure channel.

Do not paste production database credentials into GitHub issues, pull requests, chat messages, command history, screenshots or repository files.

## Pre-migration evidence

Record the following outside the repository in the approved operational evidence location:

- Professional Backup filename and creation time;
- Professional Backup download verification result;
- separate SQL backup filename and creation time;
- SQL backup size greater than zero;
- SQL backup restoration or integrity-check result;
- production database name confirmed without placing credentials in the evidence;
- operator name;
- reviewer name;
- approved migration window in Africa/Accra time.

Both backups are mandatory. Stop if either backup is missing, empty, unverified or older than the approved migration window.

## Step 1 — Confirm the migration is not already recorded

Run this read-only query against the production database:

```sql
SELECT migration_name, applied_at, description
FROM schema_migrations
WHERE migration_name = '20260729_equipment_credit_application_foundation';
```

Expected before first application: zero rows.

When one row already exists, do not blindly reapply the migration. Run the verification file first and investigate any non-zero problem count.

## Step 2 — Confirm required parent tables exist

Run this read-only check:

```sql
SELECT required.table_name,
       CASE WHEN actual.TABLE_NAME IS NULL THEN 'MISSING' ELSE 'READY' END AS status
FROM (
    SELECT 'business_locations' AS table_name
    UNION ALL SELECT 'hire_customers'
    UNION ALL SELECT 'equipment_sales_enquiries'
    UNION ALL SELECT 'equipment_sales_quotations'
    UNION ALL SELECT 'fleet_assets'
    UNION ALL SELECT 'users'
) required
LEFT JOIN information_schema.TABLES actual
  ON actual.TABLE_SCHEMA = DATABASE()
 AND actual.TABLE_TYPE = 'BASE TABLE'
 AND actual.TABLE_NAME = required.table_name;
```

Every row must return `READY`. Stop if any parent table is missing.

## Step 3 — Apply only the reviewed migration

Use the approved MySQL administration method with an interactive or securely injected password. Do not put the password directly in the command.

Example from the repository root:

```bash
mysql --host="$MYSQLHOST" --port="$MYSQLPORT" --user="$MYSQLUSER" --password --ssl-mode=REQUIRED "$MYSQLDATABASE" < database/migrations/20260729_equipment_credit_application_foundation.sql
```

The file is additive and idempotent. Do not run any rollback SQL and do not disable foreign-key checks.

## Step 4 — Run the read-only verification immediately

```bash
mysql --host="$MYSQLHOST" --port="$MYSQLPORT" --user="$MYSQLUSER" --password --ssl-mode=REQUIRED "$MYSQLDATABASE" < database/migrations/20260729_equipment_credit_application_foundation_verify.sql
```

Expected results:

- exactly one migration record for `20260729_equipment_credit_application_foundation`;
- `missing_credit_tables = 0`;
- `missing_credit_columns = 0`;
- `invalid_credit_application_rows = 0`;
- `orphan_credit_evidence_rows = 0`.

Stop the release and investigate forward when any problem count is non-zero. Do not delete tables, columns or production records to force a pass.

## Step 5 — Check application readiness

After the backend release is deployed, authenticate as an authorised Equipment Finance user with a specific equipment location selected.

Open:

- Equipment Business;
- Equipment Installment Finance;
- Credit Applications & Approval.

The foundation warning must disappear. The readiness API must return success and report no missing tables.

## Step 6 — Controlled smoke test

Use an approved test customer and an approved installment quotation at the selected equipment location.

Verify this sequence:

1. Create a draft credit application.
2. Confirm customer, quotation, equipment and location are correct.
3. Enter KYC, income, costs, household expenses, existing debt and consent.
4. Save and recalculate affordability.
5. Confirm risk score, risk band, ratios and recommendation are visible.
6. Submit for review.
7. As an authorised manager, start review.
8. Verify or reject KYC.
9. Request changes or record an approval/decline decision.
10. Confirm decision history records each action.

## Mandatory negative checks

Confirm that approving the test application does **not**:

- create a row in `equipment_sale_agreements`;
- create installment schedules or payments;
- change an existing agreement balance;
- reserve or lock the fleet asset;
- change a Hire contract;
- create delivery or ownership-transfer evidence;
- send SMS automatically.

## Post-migration evidence

Record:

- migration execution time;
- migration-record query result;
- all verification result values;
- authenticated readiness result;
- smoke-test application number;
- operator and reviewer sign-off;
- any observed issue and its forward-correction plan.

Do not store customer ID numbers, bank statements, database credentials or other sensitive KYC contents in release comments.

## Failure handling

Do not perform a destructive automatic rollback.

When the migration command fails before completion:

1. preserve the exact error without exposing credentials;
2. run the read-only verification file;
3. compare created tables and columns with the reviewed migration;
4. prepare a new timestamped additive correction migration;
5. pass migration safety, backend tests, frontend tests, dependency checks, secret scans and CodeQL;
6. apply the correction only after renewed backup and approval.

## Completion condition

This production migration is complete only when both backup requirements are documented, all verification problem counts are zero, the authenticated readiness check succeeds, and the controlled smoke test confirms that approval remains separate from agreement activation.
