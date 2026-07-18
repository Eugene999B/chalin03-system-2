-- CHALIN 03 RELEASE 3D READ-ONLY VERIFICATION
SELECT
  SUM(TABLE_NAME = 'notification_rules') AS notification_rules_table,
  SUM(TABLE_NAME = 'notifications') AS notifications_table,
  SUM(TABLE_NAME = 'notification_user_states') AS notification_user_states_table,
  SUM(TABLE_NAME = 'notification_escalations') AS notification_escalations_table,
  SUM(TABLE_NAME = 'notification_sync_runs') AS notification_sync_runs_table
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'notification_rules', 'notifications', 'notification_user_states',
    'notification_escalations', 'notification_sync_runs'
  );

SELECT COUNT(*) AS notification_rule_count
FROM notification_rules;

SELECT COUNT(*) AS migration_record_count
FROM schema_migrations
WHERE migration_name = '20260718_release3d_notifications_group_alerts';

SELECT COUNT(*) AS invalid_notification_scope_count
FROM notifications n
LEFT JOIN mining_sites ms ON ms.id = n.mining_site_id
LEFT JOIN business_locations bl ON bl.id = n.hire_location_id
LEFT JOIN business_units bu ON bu.id = bl.business_unit_id
WHERE (n.workspace_code = 'mining' AND n.mining_site_id IS NOT NULL AND ms.id IS NULL)
   OR (n.workspace_code = 'equipment_hire' AND n.hire_location_id IS NOT NULL AND (bl.id IS NULL OR bu.code <> 'equipment_hire'))
   OR (n.workspace_code = 'spare_parts' AND n.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM branches b WHERE b.id = n.branch_id));

SELECT COUNT(*) AS orphan_notification_state_count
FROM notification_user_states nus
LEFT JOIN notifications n ON n.id = nus.notification_id
LEFT JOIN users u ON u.id = nus.user_id
WHERE n.id IS NULL OR u.id IS NULL;
