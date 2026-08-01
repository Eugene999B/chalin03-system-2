-- Equipment Installment Finance company-wide stabilization verifier.
-- Every result must be exactly zero.

SELECT COUNT(*) AS missing_finance_stabilization_columns
FROM (
    SELECT 'equipment_sales_quotations' AS table_name, 'proposed_interval_days' AS column_name
    UNION ALL SELECT 'equipment_sales_quotations', 'proposed_non_working_day_rule'
    UNION ALL SELECT 'equipment_credit_applications', 'proposed_interval_days'
    UNION ALL SELECT 'equipment_credit_applications', 'proposed_non_working_day_rule'
    UNION ALL SELECT 'equipment_credit_applications', 'proposed_periodic_amount'
    UNION ALL SELECT 'equipment_sale_agreements', 'payment_interval_days'
    UNION ALL SELECT 'equipment_sale_agreements', 'non_working_day_rule'
) required
LEFT JOIN information_schema.COLUMNS column_info
  ON column_info.TABLE_SCHEMA = DATABASE()
 AND column_info.TABLE_NAME = required.table_name
 AND column_info.COLUMN_NAME = required.column_name
WHERE column_info.COLUMN_NAME IS NULL;

SELECT COUNT(*) AS non_nullable_finance_location_columns
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
      'equipment_credit_applications',
      'equipment_sales_quotations',
      'equipment_sales_quotation_items',
      'equipment_sale_agreements',
      'equipment_asset_sale_locks',
      'equipment_sale_payments',
      'equipment_deliveries',
      'equipment_ownership_transfers',
      'equipment_sales_reminder_log'
  )
  AND COLUMN_NAME = 'hire_location_id'
  AND IS_NULLABLE <> 'YES';

SELECT (
    (SELECT COUNT(*) FROM equipment_credit_applications WHERE hire_location_id IS NOT NULL)
    +
    (SELECT COUNT(*)
       FROM equipment_sales_quotations quotation
       INNER JOIN equipment_credit_applications application
         ON application.quotation_id = quotation.id
      WHERE quotation.hire_location_id IS NOT NULL)
    +
    (SELECT COUNT(*)
       FROM equipment_sales_quotation_items item
       INNER JOIN equipment_credit_applications application
         ON application.quotation_id = item.quotation_id
      WHERE item.hire_location_id IS NOT NULL)
    +
    (SELECT COUNT(*)
       FROM equipment_sale_agreements agreement
      WHERE agreement.sale_type = 'installment'
        AND agreement.activation_source = 'approved_credit_application'
        AND agreement.hire_location_id IS NOT NULL)
    +
    (SELECT COUNT(*)
       FROM equipment_sale_payments payment
       INNER JOIN equipment_sale_agreements agreement ON agreement.id = payment.agreement_id
      WHERE agreement.sale_type = 'installment'
        AND agreement.activation_source = 'approved_credit_application'
        AND payment.hire_location_id IS NOT NULL)
) AS finance_records_with_hire_location;

SELECT COUNT(*) AS invalid_finance_interval_terms
FROM equipment_credit_applications
WHERE proposed_installment_count < 1
   OR proposed_frequency NOT IN ('weekly','fortnightly','monthly','custom')
   OR (proposed_frequency = 'weekly' AND proposed_interval_days <> 7)
   OR (proposed_frequency = 'fortnightly' AND proposed_interval_days <> 14)
   OR (proposed_frequency = 'custom' AND COALESCE(proposed_interval_days, 0) < 1)
   OR proposed_non_working_day_rule NOT IN ('exact','next_weekday','previous_weekday');

SELECT COUNT(*) AS invalid_company_wide_agreement_intervals
FROM equipment_sale_agreements
WHERE sale_type = 'installment'
  AND activation_source = 'approved_credit_application'
  AND (
      payment_frequency NOT IN ('weekly','fortnightly','monthly','custom')
      OR (payment_frequency = 'weekly' AND payment_interval_days <> 7)
      OR (payment_frequency = 'fortnightly' AND payment_interval_days <> 14)
      OR (payment_frequency = 'custom' AND COALESCE(payment_interval_days, 0) < 1)
      OR non_working_day_rule NOT IN ('exact','next_weekday','previous_weekday')
  );

SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM schema_migrations
    WHERE migration_name = '20260801_equipment_finance_company_wide_stabilization'
) THEN 0 ELSE 1 END AS finance_stabilization_migration_record_missing;
