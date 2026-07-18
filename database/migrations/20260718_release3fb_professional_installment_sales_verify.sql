-- CHALIN 03 RELEASE 3F-B VERIFICATION
-- Every returned status must be PASS and every problem_count must be 0.

SELECT
    'required_tables' AS verification,
    CASE WHEN COUNT(*) = 9 THEN 'PASS' ELSE 'FAIL' END AS status,
    9 - COUNT(*) AS problem_count
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'installment_settings',
    'installment_sequences',
    'installment_agreements',
    'installment_agreement_items',
    'installment_schedule',
    'installment_payments',
    'installment_payment_allocations',
    'installment_reschedules',
    'installment_reminder_log'
  );

SELECT
    'sales_payment_type_supports_installment' AS verification,
    CASE WHEN COLUMN_TYPE LIKE '%installment%' THEN 'PASS' ELSE 'FAIL' END AS status,
    CASE WHEN COLUMN_TYPE LIKE '%installment%' THEN 0 ELSE 1 END AS problem_count
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'sales'
  AND COLUMN_NAME = 'payment_type';

SELECT
    'branch_settings_present' AS verification,
    CASE WHEN missing_count = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
    missing_count AS problem_count
FROM (
    SELECT COUNT(*) AS missing_count
    FROM branches b
    LEFT JOIN installment_settings s ON s.branch_id = b.id
    WHERE s.id IS NULL
) verification_rows;

SELECT
    'agreement_financial_integrity' AS verification,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
    COUNT(*) AS problem_count
FROM installment_agreements
WHERE sale_total < 0
   OR deposit_amount < 0
   OR financed_amount < 0
   OR amount_paid < 0
   OR outstanding_balance < 0
   OR deposit_amount > sale_total + 0.01
   OR ABS((sale_total + late_charges_total - waived_charges_total) - (amount_paid + outstanding_balance)) > 0.05;

SELECT
    'schedule_financial_integrity' AS verification,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
    COUNT(*) AS problem_count
FROM installment_schedule
WHERE scheduled_amount < 0
   OR amount_paid < 0
   OR late_charge_amount < 0
   OR waived_charge_amount < 0
   OR amount_paid > scheduled_amount + late_charge_amount - waived_charge_amount + 0.05;

SELECT
    'cross_branch_isolation' AS verification,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
    COUNT(*) AS problem_count
FROM installment_agreements ia
INNER JOIN sales s ON s.id = ia.sale_id
WHERE ia.branch_id <> s.branch_id;

SELECT
    'migration_marker' AS verification,
    CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS status,
    CASE WHEN COUNT(*) = 1 THEN 0 ELSE 1 END AS problem_count
FROM schema_migrations
WHERE migration_name = '20260718_release3fb_professional_installment_sales';
