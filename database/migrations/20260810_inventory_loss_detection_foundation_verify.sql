-- CHALIN 03 INVENTORY LOSS DETECTION — READ-ONLY VERIFIER
-- Every problem_count must be 0.

SELECT DATABASE() AS selected_database, NOW() AS verified_at;

SELECT
    ABS(COUNT(*) - 1) AS problem_count,
    CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS result
FROM schema_migrations
WHERE migration_name = '20260810_inventory_loss_detection_foundation';

SELECT
    7 - COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 7 THEN 'PASS' ELSE 'FAIL' END AS result
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
      'inventory_count_sessions',
      'inventory_count_scope',
      'inventory_count_observations',
      'inventory_count_variances',
      'inventory_count_variance_units',
      'inventory_loss_investigations',
      'inventory_custody_handovers'
  );

SELECT
    ABS(COUNT(*) - 1) AS problem_count,
    CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS result
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'inventory_custody_handover_units';

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM inventory_count_sessions
WHERE count_type NOT IN ('blind_cycle', 'full_count', 'spot_check', 'handover')
   OR status NOT IN ('draft', 'open', 'submitted', 'reviewed', 'closed', 'cancelled')
   OR blind_mode NOT IN (0, 1)
   OR selection_method NOT IN ('manual', 'random_risk', 'random_all', 'system_alert', 'handover');

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM inventory_count_scope
WHERE expected_system_quantity < 0
   OR expected_identity_count < 0
   OR tracking_mode_snapshot NOT IN ('quantity', 'batch', 'serialized')
   OR risk_tier_snapshot NOT IN ('standard', 'elevated', 'high', 'critical');

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM inventory_count_observations
WHERE (observation_type = 'quantity_count' AND quantity_observed < 0)
   OR (observation_type IN ('unit_scan', 'manual_unit_id') AND quantity_observed <= 0)
   OR observation_type NOT IN ('unit_scan', 'manual_unit_id', 'quantity_count')
   OR validation_status NOT IN ('accepted', 'duplicate', 'unexpected', 'wrong_product', 'wrong_store', 'invalid');

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM inventory_count_variances
WHERE expected_quantity < 0
   OR observed_quantity < 0
   OR expected_identity_count < 0
   OR observed_identity_count < 0
   OR missing_identity_count < 0
   OR unexpected_identity_count < 0
   OR review_status NOT IN ('open', 'investigating', 'explained', 'confirmed_loss', 'closed');

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM inventory_count_variance_units
WHERE variance_type NOT IN ('missing', 'unexpected', 'duplicate', 'wrong_product', 'wrong_store', 'invalid')
   OR resolution_status NOT IN ('unresolved', 'found', 'count_error', 'transfer_issue', 'damage', 'confirmed_loss', 'other');

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM inventory_loss_investigations
WHERE investigation_type NOT IN (
      'missing_serialized_unit',
      'quantity_shortage',
      'unexpected_unit',
      'transfer_shortage',
      'custody_variance',
      'label_exception',
      'other'
  )
   OR severity NOT IN ('notice', 'review', 'high', 'critical')
   OR status NOT IN ('open', 'reviewing', 'awaiting_evidence', 'resolved', 'closed');

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM inventory_custody_handovers
WHERE status NOT IN ('draft', 'outgoing_confirmed', 'incoming_verification', 'closed', 'variance', 'cancelled')
   OR expected_unit_count < 0
   OR verified_unit_count < 0
   OR variance_unit_count < 0;

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM inventory_custody_handover_units
WHERE verification_status NOT IN ('pending', 'verified', 'missing', 'unexpected', 'exception');

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM inventory_count_scope s
LEFT JOIN inventory_count_sessions cs ON cs.id = s.session_id
LEFT JOIN products p ON p.id = s.product_id
WHERE cs.id IS NULL OR p.id IS NULL;

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM inventory_count_variance_units vu
LEFT JOIN inventory_count_variances v ON v.id = vu.variance_id
WHERE v.id IS NULL;

SELECT
    COUNT(*) AS problem_count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM inventory_custody_handover_units hu
LEFT JOIN inventory_custody_handovers h ON h.id = hu.handover_id
LEFT JOIN inventory_units u ON u.id = hu.unit_id
WHERE h.id IS NULL OR u.id IS NULL;
