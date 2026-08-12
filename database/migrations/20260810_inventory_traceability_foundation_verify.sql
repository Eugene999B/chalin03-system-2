-- CHALIN 03 INVENTORY TRACEABILITY FOUNDATION — READ-ONLY VERIFIER
-- Every problem_count must be 0 and the migration marker must exist exactly once.

SELECT DATABASE() AS selected_database, NOW() AS verified_at;

SELECT
    ABS(COUNT(*) - 1) AS problem_count,
    CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS result
FROM schema_migrations
WHERE migration_name = '20260810_inventory_traceability_foundation';

SELECT
    6 - COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 6 THEN 'PASS' ELSE 'FAIL' END AS result
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'products'
  AND COLUMN_NAME IN (
      'inventory_tracking_mode',
      'inventory_product_code',
      'inventory_risk_tier',
      'inventory_traceability_state',
      'inventory_traceability_configured_by',
      'inventory_traceability_configured_at'
  );

SELECT
    4 - COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 4 THEN 'PASS' ELSE 'FAIL' END AS result
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
      'inventory_label_batches',
      'inventory_units',
      'inventory_unit_events',
      'inventory_label_print_events'
  );

SELECT
    ABS(COUNT(DISTINCT INDEX_NAME) - 1) AS problem_count,
    CASE WHEN COUNT(DISTINCT INDEX_NAME) = 1 THEN 'PASS' ELSE 'FAIL' END AS result
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'inventory_label_batches'
  AND INDEX_NAME = 'uq_inventory_label_batch_source_item';

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM products
WHERE inventory_tracking_mode NOT IN ('quantity', 'batch', 'serialized')
   OR inventory_risk_tier NOT IN ('standard', 'elevated', 'high', 'critical')
   OR inventory_traceability_state NOT IN ('off', 'setup', 'enforced');

-- Exact-ID enforcement is valid only for serialized products. The application
-- separately requires full physical identity reconciliation when enforcement is
-- enabled for the first time. After activation, legitimate lifecycle states such
-- as sold, in_transit and returned_quarantine mean a read-only verifier must not
-- require every enforced identity to remain active forever.
SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM products
WHERE inventory_traceability_state = 'enforced'
  AND inventory_tracking_mode <> 'serialized';

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM products
WHERE inventory_tracking_mode IN ('batch', 'serialized')
  AND (inventory_product_code IS NULL OR TRIM(inventory_product_code) = '');

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM products
WHERE inventory_traceability_state = 'enforced'
  AND (
      inventory_traceability_configured_by IS NULL
      OR inventory_traceability_configured_at IS NULL
  );

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM (
    SELECT branch_id, inventory_product_code
    FROM products
    WHERE inventory_product_code IS NOT NULL
      AND TRIM(inventory_product_code) <> ''
    GROUP BY branch_id, inventory_product_code
    HAVING COUNT(*) > 1
) duplicate_product_codes;

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM inventory_label_batches
WHERE expected_quantity < 0
   OR generated_quantity < 0
   OR activated_quantity < 0
   OR voided_quantity < 0
   OR generated_quantity > expected_quantity
   OR activated_quantity + voided_quantity > generated_quantity;

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM inventory_label_batches
WHERE status NOT IN ('draft', 'generated', 'printed', 'verification', 'activated', 'cancelled');

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM (
    SELECT branch_id, source_type, source_id, source_item_id
    FROM inventory_label_batches
    WHERE source_id IS NOT NULL
      AND source_item_id IS NOT NULL
    GROUP BY branch_id, source_type, source_id, source_item_id
    HAVING COUNT(*) > 1
) duplicate_source_item_batches;

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM inventory_units
WHERE status NOT IN (
    'label_pending',
    'active',
    'reserved_sale',
    'in_transit',
    'sold',
    'returned_quarantine',
    'damaged',
    'missing',
    'written_off',
    'voided'
);

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM (
    SELECT unit_code
    FROM inventory_units
    GROUP BY unit_code
    HAVING COUNT(*) > 1
) duplicate_unit_codes;

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM inventory_units u
LEFT JOIN products p ON p.id = u.product_id
LEFT JOIN branches ob ON ob.id = u.origin_branch_id
LEFT JOIN branches cb ON cb.id = u.current_branch_id
LEFT JOIN inventory_label_batches b ON b.id = u.label_batch_id
WHERE p.id IS NULL
   OR ob.id IS NULL
   OR cb.id IS NULL
   OR b.id IS NULL;

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM inventory_unit_events e
LEFT JOIN inventory_units u ON u.id = e.unit_id
WHERE u.id IS NULL
   OR e.event_sequence <= 0
   OR e.event_hash IS NULL
   OR CHAR_LENGTH(e.event_hash) <> 64;

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM (
    SELECT unit_id, event_sequence
    FROM inventory_unit_events
    GROUP BY unit_id, event_sequence
    HAVING COUNT(*) > 1
) duplicate_event_sequences;

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM inventory_label_print_events
WHERE copies <= 0
   OR print_format NOT IN ('sticker', 'thermal', 'a4', 'other');
