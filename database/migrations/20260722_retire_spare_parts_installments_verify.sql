-- READ-ONLY VERIFICATION: SPARE PARTS INSTALLMENT RETIREMENT

SELECT DATABASE() AS selected_database;

SELECT
    migration_name,
    applied_at,
    description
FROM schema_migrations
WHERE migration_name = '20260722_retire_spare_parts_installments';

SELECT
    TRIGGER_NAME,
    EVENT_MANIPULATION,
    EVENT_OBJECT_TABLE,
    ACTION_TIMING
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = DATABASE()
  AND TRIGGER_NAME IN (
    'trg_spare_parts_installment_retired_sales_insert',
    'trg_spare_parts_installment_retired_agreement_insert'
  )
ORDER BY TRIGGER_NAME;

SELECT COUNT(*) AS historical_spare_parts_installment_agreements
FROM installment_agreements;

SELECT COUNT(*) AS historical_spare_parts_installment_payments
FROM installment_payments;

SELECT COUNT(*) AS historical_spare_parts_installment_sales
FROM sales
WHERE LOWER(COALESCE(payment_type, '')) = 'installment';
