-- Read-only verifier for the Chalin 03 payroll financial foundation.

SELECT migration_name, description, applied_at
FROM schema_migrations
WHERE migration_name = '20260810_payroll_financial_foundation';

SELECT
  11 - COUNT(*) AS missing_payroll_tables
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'payroll_statutory_rule_versions',
    'payroll_compensation_profiles',
    'payroll_recurring_components',
    'payroll_periods',
    'payroll_entries',
    'payroll_entry_lines',
    'payroll_salary_payments',
    'payroll_adjustment_requests',
    'payroll_worker_loans',
    'payroll_loan_transactions',
    'payroll_payslips'
  );

SELECT
  COUNT(*) AS compensation_worker_workspace_mismatches
FROM payroll_compensation_profiles compensation
INNER JOIN worker_profiles worker ON worker.id = compensation.worker_id
WHERE compensation.workspace_code <> worker.workspace_code;

SELECT
  COUNT(*) AS entry_worker_workspace_mismatches
FROM payroll_entries entry_record
INNER JOIN worker_profiles worker ON worker.id = entry_record.worker_id
WHERE entry_record.workspace_code <> worker.workspace_code;

SELECT
  COUNT(*) AS payment_worker_workspace_mismatches
FROM payroll_salary_payments payment
INNER JOIN worker_profiles worker ON worker.id = payment.worker_id
WHERE payment.workspace_code <> worker.workspace_code;

SELECT
  COUNT(*) AS self_approved_compensation_profiles
FROM payroll_compensation_profiles
WHERE approved_by IS NOT NULL
  AND created_by IS NOT NULL
  AND approved_by = created_by;

SELECT
  COUNT(*) AS self_approved_payroll_periods
FROM payroll_periods
WHERE approved_by IS NOT NULL
  AND prepared_by IS NOT NULL
  AND approved_by = prepared_by;
