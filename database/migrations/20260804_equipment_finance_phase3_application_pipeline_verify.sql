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
    SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE
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
        COLUMN_TYPE LIKE "%''draft''%" AND COLUMN_TYPE LIKE "%''submitted''%" AND
        COLUMN_TYPE LIKE "%''under_review''%" AND COLUMN_TYPE LIKE "%''changes_requested''%" AND
        COLUMN_TYPE LIKE "%''approved''%" AND COLUMN_TYPE LIKE "%''declined''%" AND
        COLUMN_TYPE LIKE "%''withdrawn''%"
    ))
 OR (TABLE_NAME = 'equipment_credit_applications' AND COLUMN_NAME = 'kyc_status' AND NOT (
        COLUMN_TYPE LIKE "%''not_started''%" AND COLUMN_TYPE LIKE "%''incomplete''%" AND
        COLUMN_TYPE LIKE "%''complete''%" AND COLUMN_TYPE LIKE "%''verified''%" AND
        COLUMN_TYPE LIKE "%''rejected''%"
    ))
 OR (TABLE_NAME = 'equipment_credit_applications' AND COLUMN_NAME = 'affordability_status' AND NOT (
        COLUMN_TYPE LIKE "%''not_assessed''%" AND COLUMN_TYPE LIKE "%''eligible''%" AND
        COLUMN_TYPE LIKE "%''manual_review''%" AND COLUMN_TYPE LIKE "%''ineligible''%"
    ))
 OR (TABLE_NAME = 'equipment_credit_applications' AND COLUMN_NAME = 'risk_band' AND NOT (
        COLUMN_TYPE LIKE "%''low''%" AND COLUMN_TYPE LIKE "%''medium''%" AND
        COLUMN_TYPE LIKE "%''high''%" AND COLUMN_TYPE LIKE "%''critical''%"
    ))
 OR (TABLE_NAME = 'equipment_credit_applications' AND COLUMN_NAME = 'proposed_frequency' AND NOT (
        COLUMN_TYPE LIKE "%''weekly''%" AND COLUMN_TYPE LIKE "%''fortnightly''%" AND
        COLUMN_TYPE LIKE "%''monthly''%" AND COLUMN_TYPE LIKE "%''custom''%"
    ))
 OR (TABLE_NAME = 'equipment_credit_applications' AND COLUMN_NAME = 'proposed_non_working_day_rule' AND NOT (
        COLUMN_TYPE LIKE "%''exact''%" AND COLUMN_TYPE LIKE "%''next_weekday''%" AND
        COLUMN_TYPE LIKE "%''previous_weekday''%"
    ))
 OR (TABLE_NAME = 'equipment_sales_quotations' AND COLUMN_NAME = 'status' AND NOT (
        COLUMN_TYPE LIKE "%''draft''%" AND COLUMN_TYPE LIKE "%''pending_approval''%" AND
        COLUMN_TYPE LIKE "%''approved''%" AND COLUMN_TYPE LIKE "%''accepted''%" AND
        COLUMN_TYPE LIKE "%''rejected''%" AND COLUMN_TYPE LIKE "%''expired''%" AND
        COLUMN_TYPE LIKE "%''converted''%" AND COLUMN_TYPE LIKE "%''cancelled''%"
    ))
 OR (TABLE_NAME = 'equipment_sales_quotations' AND COLUMN_NAME = 'proposed_frequency' AND NOT (
        COLUMN_TYPE LIKE "%''weekly''%" AND COLUMN_TYPE LIKE "%''fortnightly''%" AND
        COLUMN_TYPE LIKE "%''monthly''%" AND COLUMN_TYPE LIKE "%''custom''%"
    ))
 OR (TABLE_NAME = 'equipment_sales_quotations' AND COLUMN_NAME = 'proposed_non_working_day_rule' AND NOT (
        COLUMN_TYPE LIKE "%''exact''%" AND COLUMN_TYPE LIKE "%''next_weekday''%" AND
        COLUMN_TYPE LIKE "%''previous_weekday''%"
    ))
 OR (TABLE_NAME = 'equipment_credit_application_decisions' AND COLUMN_NAME = 'action_type' AND NOT (
        COLUMN_TYPE LIKE "%''created''%" AND COLUMN_TYPE LIKE "%''updated''%" AND
        COLUMN_TYPE LIKE "%''assessed''%" AND COLUMN_TYPE LIKE "%''submitted''%" AND
        COLUMN_TYPE LIKE "%''review_started''%" AND COLUMN_TYPE LIKE "%''changes_requested''%" AND
        COLUMN_TYPE LIKE "%''approved''%" AND COLUMN_TYPE LIKE "%''declined''%" AND
        COLUMN_TYPE LIKE "%''withdrawn''%" AND COLUMN_TYPE LIKE "%''kyc_verified''%"
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
