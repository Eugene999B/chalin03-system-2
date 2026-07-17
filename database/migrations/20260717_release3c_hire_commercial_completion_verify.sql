-- CHALIN 03 RELEASE 3C — READ-ONLY VERIFICATION
SELECT COUNT(*) AS release3c_required_tables
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'hire_rate_cards',
    'hire_quotation_items',
    'hire_contract_items',
    'hire_contract_amendments',
    'hire_deposit_transactions',
    'hire_commercial_approvals',
    'hire_evidence_files',
    'hire_damage_assessments'
  );

SELECT COUNT(*) AS release3c_required_columns
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND (
    (TABLE_NAME = 'hire_dispatches' AND COLUMN_NAME = 'dispatch_number') OR
    (TABLE_NAME = 'hire_return_inspections' AND COLUMN_NAME = 'return_number') OR
    (TABLE_NAME = 'hire_quotations' AND COLUMN_NAME IN ('commercial_version', 'approval_reason')) OR
    (TABLE_NAME = 'hire_contracts' AND COLUMN_NAME = 'commercial_version')
  );

SELECT COUNT(*) AS release3c_document_sequences
FROM document_sequences
WHERE sequence_code IN ('HRTC', 'HAMD', 'HDEP', 'HAPR', 'HEVD', 'HDMG');

SELECT COUNT(*) AS release3c_migration_record
FROM schema_migrations
WHERE migration_name = 'release3c_hire_commercial_completion';

SELECT COUNT(*) AS cross_location_quotation_items
FROM hire_quotation_items hqi
INNER JOIN hire_quotations hq ON hq.id = hqi.quotation_id
WHERE hqi.hire_location_id <> hq.hire_location_id;

SELECT COUNT(*) AS cross_location_contract_items
FROM hire_contract_items hci
INNER JOIN hire_contracts hc ON hc.id = hci.contract_id
WHERE hci.hire_location_id <> hc.hire_location_id;

SELECT COUNT(*) AS invalid_commercial_amounts
FROM (
    SELECT id FROM hire_rate_cards
    WHERE standard_rate < 0 OR minimum_quantity < 0
    UNION ALL
    SELECT id FROM hire_quotation_items
    WHERE rate < 0 OR estimated_quantity < 0 OR minimum_quantity < 0
       OR line_subtotal < 0 OR discount_amount < 0 OR tax_amount < 0 OR line_total < 0
    UNION ALL
    SELECT id FROM hire_deposit_transactions
    WHERE amount <= 0
    UNION ALL
    SELECT id FROM hire_damage_assessments
    WHERE assessed_amount < 0 OR customer_liability_amount < 0
       OR deposit_applied_amount < 0 OR invoiced_amount < 0
       OR waived_amount < 0 OR settled_amount < 0
) invalid_rows;

SELECT COUNT(*) AS legacy_quotes_without_items
FROM hire_quotations hq
LEFT JOIN hire_quotation_items hqi ON hqi.quotation_id = hq.id
WHERE hqi.id IS NULL;

SELECT COUNT(*) AS legacy_contracts_without_items
FROM hire_contracts hc
LEFT JOIN hire_contract_items hci ON hci.contract_id = hc.id
WHERE hci.id IS NULL;
