-- READ-ONLY VERIFICATION.
SELECT migration_name,applied_at FROM schema_migrations WHERE migration_name='20261125_customer_credit_approval_queue';
SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customer_credit_approval_requests' ORDER BY ORDINAL_POSITION;
SELECT COUNT(*) AS invalid_approval_records FROM customer_credit_approval_requests WHERE new_debt_pesewas=0 OR score_at_request>100 OR reviewed_by=requested_by OR (status='executed' AND executed_sale_id IS NULL);
