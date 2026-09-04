SELECT COUNT(*) AS missing_phase3_tables
FROM (
    SELECT 'equipment_credit_applications' AS table_name
    UNION ALL SELECT 'equipment_sales_quotations'
    UNION ALL SELECT 'equipment_sales_quotation_items'
    UNION ALL SELECT 'equipment_credit_application_kyc'
    UNION ALL SELECT 'equipment_credit_application_decisions'
    UNION ALL SELECT 'hire_customers'
    UNION ALL SELECT 'fleet_assets'
) required
WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.TABLES actual
    WHERE actual.TABLE_SCHEMA = DATABASE()
      AND actual.TABLE_NAME = required.table_name
);

SELECT COUNT(*) AS missing_phase3_columns
FROM (
    SELECT 'equipment_credit_applications' AS table_name, 'proposed_interval_days' AS column_name
    UNION ALL SELECT 'equipment_credit_applications', 'proposed_non_working_day_rule'
    UNION ALL SELECT 'equipment_credit_applications', 'proposed_periodic_amount'
    UNION ALL SELECT 'equipment_credit_applications', 'decision_version'
    UNION ALL SELECT 'equipment_credit_applications', 'submitted_by'
    UNION ALL SELECT 'equipment_credit_applications', 'submitted_at'
    UNION ALL SELECT 'equipment_credit_applications', 'reviewed_by'
    UNION ALL SELECT 'equipment_credit_applications', 'reviewed_at'
    UNION ALL SELECT 'equipment_credit_applications', 'decision_reason'
    UNION ALL SELECT 'equipment_sales_quotations', 'proposed_interval_days'
    UNION ALL SELECT 'equipment_sales_quotations', 'proposed_non_working_day_rule'
    UNION ALL SELECT 'equipment_sales_quotation_items', 'main_image_url_snapshot'
    UNION ALL SELECT 'equipment_credit_application_decisions', 'application_id'
    UNION ALL SELECT 'equipment_credit_application_decisions', 'decision_version'
    UNION ALL SELECT 'equipment_credit_application_decisions', 'action_type'
    UNION ALL SELECT 'equipment_credit_application_decisions', 'from_status'
    UNION ALL SELECT 'equipment_credit_application_decisions', 'to_status'
    UNION ALL SELECT 'equipment_credit_application_decisions', 'notes'
    UNION ALL SELECT 'equipment_credit_application_decisions', 'snapshot_json'
    UNION ALL SELECT 'equipment_credit_application_decisions', 'decided_by'
    UNION ALL SELECT 'equipment_credit_application_decisions', 'decided_at'
) required
WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS actual
    WHERE actual.TABLE_SCHEMA = DATABASE()
      AND actual.TABLE_NAME = required.table_name
      AND actual.COLUMN_NAME = required.column_name
);

SELECT COUNT(*) AS invalid_phase3_location_nullability
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
      'equipment_credit_applications',
      'equipment_sales_quotations',
      'equipment_sales_quotation_items'
  )
  AND COLUMN_NAME = 'hire_location_id'
  AND IS_NULLABLE = 'NO';

SELECT COUNT(*) AS invalid_phase3_workflow_enums
FROM (
    SELECT TABLE_NAME, COLUMN_NAME, LOWER(COLUMN_TYPE) AS column_type
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND (
        (TABLE_NAME = 'equipment_credit_applications' AND COLUMN_NAME IN (
            'application_status','kyc_status','affordability_status',
            'risk_band','proposed_frequency','proposed_non_working_day_rule'
        ))
        OR (TABLE_NAME = 'equipment_sales_quotations' AND COLUMN_NAME IN (
            'status','proposed_frequency','proposed_non_working_day_rule'
        ))
        OR (TABLE_NAME = 'equipment_credit_application_decisions' AND COLUMN_NAME = 'action_type')
      )
) actual
WHERE
    (TABLE_NAME = 'equipment_credit_applications' AND COLUMN_NAME = 'application_status' AND NOT (
        column_type LIKE '%draft%' AND column_type LIKE '%submitted%' AND
        column_type LIKE '%under_review%' AND column_type LIKE '%changes_requested%' AND
        column_type LIKE '%approved%' AND column_type LIKE '%declined%' AND
        column_type LIKE '%withdrawn%'
    ))
 OR (TABLE_NAME = 'equipment_credit_applications' AND COLUMN_NAME = 'kyc_status' AND NOT (
        column_type LIKE '%not_started%' AND column_type LIKE '%incomplete%' AND
        column_type LIKE '%complete%' AND column_type LIKE '%verified%' AND
        column_type LIKE '%rejected%'
    ))
 OR (TABLE_NAME = 'equipment_credit_applications' AND COLUMN_NAME = 'affordability_status' AND NOT (
        column_type LIKE '%not_assessed%' AND column_type LIKE '%eligible%' AND
        column_type LIKE '%manual_review%' AND column_type LIKE '%ineligible%'
    ))
 OR (TABLE_NAME = 'equipment_credit_applications' AND COLUMN_NAME = 'risk_band' AND NOT (
        column_type LIKE '%low%' AND column_type LIKE '%medium%' AND
        column_type LIKE '%high%' AND column_type LIKE '%critical%'
    ))
 OR (TABLE_NAME = 'equipment_credit_applications' AND COLUMN_NAME = 'proposed_frequency' AND NOT (
        column_type LIKE '%weekly%' AND column_type LIKE '%fortnightly%' AND
        column_type LIKE '%monthly%' AND column_type LIKE '%custom%'
    ))
 OR (TABLE_NAME = 'equipment_credit_applications' AND COLUMN_NAME = 'proposed_non_working_day_rule' AND NOT (
        column_type LIKE '%exact%' AND column_type LIKE '%next_weekday%' AND
        column_type LIKE '%previous_weekday%'
    ))
 OR (TABLE_NAME = 'equipment_sales_quotations' AND COLUMN_NAME = 'status' AND NOT (
        column_type LIKE '%draft%' AND column_type LIKE '%pending_approval%' AND
        column_type LIKE '%approved%' AND column_type LIKE '%accepted%' AND
        column_type LIKE '%rejected%' AND column_type LIKE '%expired%' AND
        column_type LIKE '%converted%' AND column_type LIKE '%cancelled%'
    ))
 OR (TABLE_NAME = 'equipment_sales_quotations' AND COLUMN_NAME = 'proposed_frequency' AND NOT (
        column_type LIKE '%weekly%' AND column_type LIKE '%fortnightly%' AND
        column_type LIKE '%monthly%' AND column_type LIKE '%custom%'
    ))
 OR (TABLE_NAME = 'equipment_sales_quotations' AND COLUMN_NAME = 'proposed_non_working_day_rule' AND NOT (
        column_type LIKE '%exact%' AND column_type LIKE '%next_weekday%' AND
        column_type LIKE '%previous_weekday%'
    ))
 OR (TABLE_NAME = 'equipment_credit_application_decisions' AND COLUMN_NAME = 'action_type' AND NOT (
        column_type LIKE '%created%' AND column_type LIKE '%updated%' AND
        column_type LIKE '%assessed%' AND column_type LIKE '%submitted%' AND
        column_type LIKE '%review_started%' AND column_type LIKE '%changes_requested%' AND
        column_type LIKE '%approved%' AND column_type LIKE '%declined%' AND
        column_type LIKE '%withdrawn%' AND column_type LIKE '%kyc_verified%'
    ));

SELECT COUNT(*) AS missing_phase3_indexes
FROM (
    SELECT 'equipment_credit_applications' AS table_name, 'idx_finance_app_status_updated' AS index_name
    UNION ALL SELECT 'equipment_credit_applications', 'idx_finance_app_customer'
    UNION ALL SELECT 'equipment_credit_applications', 'idx_finance_app_quotation'
    UNION ALL SELECT 'equipment_credit_applications', 'idx_finance_app_asset_status'
    UNION ALL SELECT 'equipment_credit_application_kyc', 'idx_finance_kyc_application'
    UNION ALL SELECT 'equipment_credit_application_decisions', 'idx_finance_decision_application_version'
) required
WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS actual
    WHERE actual.TABLE_SCHEMA = DATABASE()
      AND actual.TABLE_NAME = required.table_name
      AND actual.INDEX_NAME = required.index_name
);

SELECT COUNT(*) AS phase3_migration_record_missing
FROM (SELECT 1 AS expected) marker
WHERE NOT EXISTS (
    SELECT 1 FROM schema_migrations
    WHERE migration_name = '20260804_equipment_finance_phase3_application_pipeline'
);
