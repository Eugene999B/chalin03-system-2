-- CHALIN 03 RELEASE 3B — POST-MIGRATION VERIFICATION
-- Read-only checks. This file does not change business data.

SELECT
    'release3b_required_tables' AS check_name,
    COUNT(*) AS present_tables,
    10 AS expected_tables,
    CASE WHEN COUNT(*) = 10 THEN 'PASS' ELSE 'PROBLEM' END AS result
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
      'mining_stockpiles',
      'mining_stockpile_movements',
      'mining_dispatches',
      'mining_fuel_tanks',
      'mining_fuel_transactions',
      'mining_fuel_reconciliations',
      'mining_contractors',
      'mining_shift_crews',
      'mining_shift_crew_members',
      'mining_site_closings'
  );

SELECT
    'release3b_document_sequences' AS check_name,
    COUNT(*) AS present_sequences,
    6 AS expected_sequences,
    CASE WHEN COUNT(*) = 6 THEN 'PASS' ELSE 'PROBLEM' END AS result
FROM document_sequences
WHERE sequence_code IN ('MSTK', 'MDSP', 'MFUE', 'MSCL', 'MCRW', 'MFRC');

SELECT
    'invalid_stockpile_balances' AS check_name,
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'PROBLEM' END AS result
FROM mining_stockpiles
WHERE opening_quantity < 0
   OR current_quantity < 0
   OR minimum_quantity < 0
   OR (capacity_quantity IS NOT NULL AND current_quantity > capacity_quantity);

SELECT
    'invalid_fuel_tank_balances' AS check_name,
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'PROBLEM' END AS result
FROM mining_fuel_tanks
WHERE capacity_litres <= 0
   OR opening_balance_litres < 0
   OR current_balance_litres < 0
   OR current_balance_litres > capacity_litres
   OR minimum_level_litres < 0;

SELECT
    'cross_site_dispatch_stockpiles' AS check_name,
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'PROBLEM' END AS result
FROM mining_dispatches d
INNER JOIN mining_stockpiles s ON s.id = d.stockpile_id
WHERE d.site_id <> s.site_id;

SELECT
    'cross_site_stockpile_movements' AS check_name,
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'PROBLEM' END AS result
FROM mining_stockpile_movements m
INNER JOIN mining_stockpiles s ON s.id = m.stockpile_id
WHERE m.site_id <> s.site_id;

SELECT
    'cross_site_fuel_transactions' AS check_name,
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'PROBLEM' END AS result
FROM mining_fuel_transactions f
INNER JOIN mining_fuel_tanks t ON t.id = f.tank_id
WHERE f.site_id <> t.site_id;

SELECT
    'cross_site_shift_contractors' AS check_name,
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'PROBLEM' END AS result
FROM mining_shift_crews c
INNER JOIN mining_contractors contractor ON contractor.id = c.contractor_id
WHERE c.site_id <> contractor.site_id;

SELECT
    'orphan_shift_crew_members' AS check_name,
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'PROBLEM' END AS result
FROM mining_shift_crew_members member
LEFT JOIN mining_shift_crews crew ON crew.id = member.crew_id
WHERE crew.id IS NULL;

SELECT
    'release3b_schema_migration_marker' AS check_name,
    COUNT(*) AS present_markers,
    1 AS expected_markers,
    CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'PROBLEM' END AS result
FROM schema_migrations
WHERE migration_name = 'release3b_mining_operations_control';
