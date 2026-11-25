-- READ-ONLY VERIFICATION. Run after the controlled migration.
SELECT migration_name,applied_at FROM schema_migrations WHERE migration_name='20261125_customer_credit_foundation';
SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('customer_credit_profiles','customer_credit_settings','customer_credit_score_events') ORDER BY TABLE_NAME;
SELECT COUNT(*) AS missing_customer_profiles FROM customers c LEFT JOIN customer_credit_profiles p ON p.customer_id=c.id WHERE p.customer_id IS NULL;
SELECT COUNT(*) AS missing_branch_settings FROM branches b LEFT JOIN customer_credit_settings s ON s.branch_id=b.id WHERE s.branch_id IS NULL;
SELECT COUNT(*) AS invalid_scores FROM customer_credit_profiles WHERE score>100;
SELECT COUNT(*) AS invalid_terms FROM customer_credit_settings WHERE term_months NOT BETWEEN 1 AND 12;
SELECT COUNT(*) AS debt_count,COALESCE(SUM(balance),0) AS total_balance FROM debts;
