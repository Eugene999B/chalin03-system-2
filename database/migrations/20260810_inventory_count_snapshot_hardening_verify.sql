-- CHALIN 03 INVENTORY COUNT SNAPSHOT HARDENING — READ-ONLY VERIFIER

SELECT DATABASE() AS selected_database, NOW() AS verified_at;

SELECT
    ABS(COUNT(*) - 1) AS problem_count,
    CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS result
FROM schema_migrations
WHERE migration_name = '20260810_inventory_count_snapshot_hardening';

SELECT
    ABS(COUNT(*) - 1) AS problem_count,
    CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS result
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'inventory_count_expected_units';

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM inventory_count_expected_units eu
LEFT JOIN inventory_count_sessions s ON s.id = eu.session_id
LEFT JOIN inventory_count_scope sc ON sc.id = eu.scope_id
LEFT JOIN products p ON p.id = eu.product_id
LEFT JOIN inventory_units u ON u.id = eu.unit_id
WHERE s.id IS NULL
   OR sc.id IS NULL
   OR p.id IS NULL
   OR u.id IS NULL
   OR sc.session_id <> eu.session_id
   OR sc.product_id <> eu.product_id;

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM (
    SELECT scope_id, unit_id
    FROM inventory_count_expected_units
    GROUP BY scope_id, unit_id
    HAVING COUNT(*) > 1
) duplicate_expected_units;

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM inventory_count_expected_units
WHERE unit_code_snapshot IS NULL
   OR TRIM(unit_code_snapshot) = ''
   OR status_snapshot NOT IN (
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
