-- CHALIN 03 INVENTORY TRACEABILITY — SERIALIZED STOCK TRANSFERS READ-ONLY VERIFIER
-- Every problem_count must be 0.

SELECT DATABASE() AS selected_database, NOW() AS verified_at;

SELECT
    ABS(COUNT(*) - 1) AS problem_count,
    CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS result
FROM schema_migrations
WHERE migration_name = '20260811_inventory_transfer_traceability';

SELECT
    ABS(COUNT(*) - 1) AS problem_count,
    CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS result
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'inventory_transfer_units';

SELECT
    16 - COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 16 THEN 'PASS' ELSE 'FAIL' END AS result
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'inventory_transfer_units'
  AND COLUMN_NAME IN (
      'id', 'transfer_id', 'transfer_item_id', 'unit_id', 'unit_code_snapshot',
      'source_product_id', 'destination_product_id', 'from_branch_id', 'to_branch_id',
      'dispatch_status', 'receipt_status', 'dispatched_by', 'dispatched_at',
      'received_by', 'received_at', 'receipt_note'
  );

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM inventory_transfer_units
WHERE dispatch_status NOT IN ('in_transit', 'received', 'exception')
   OR receipt_status NOT IN ('pending', 'received', 'missing', 'exception')
   OR from_branch_id = to_branch_id;

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM inventory_transfer_units itu
LEFT JOIN inventory_units u ON u.id = itu.unit_id
LEFT JOIN products sp ON sp.id = itu.source_product_id
LEFT JOIN branches fb ON fb.id = itu.from_branch_id
LEFT JOIN branches tb ON tb.id = itu.to_branch_id
WHERE u.id IS NULL OR sp.id IS NULL OR fb.id IS NULL OR tb.id IS NULL;

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM inventory_transfer_units
WHERE receipt_status = 'received'
  AND (destination_product_id IS NULL OR received_at IS NULL);

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM inventory_transfer_units
WHERE receipt_status = 'missing'
  AND received_at IS NOT NULL;
