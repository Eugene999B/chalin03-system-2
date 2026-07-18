-- CHALIN 03 RELEASE 3F-C2 READ-ONLY VERIFICATION
SELECT DATABASE() AS selected_database, NOW() AS verified_at;

SELECT migration_name, applied_at, description
FROM schema_migrations
WHERE migration_name = 'release3fc2_category_isolation_guides_receipts_workers';

SELECT TABLE_NAME, TABLE_ROWS
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
      'user_category_assignment_conflicts',
      'worker_category_assignment_conflicts'
  )
ORDER BY TABLE_NAME;

SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND (
      (TABLE_NAME = 'users' AND COLUMN_NAME IN (
          'primary_workspace_code',
          'category_assignment_status',
          'category_conflict_reason',
          'category_assignment_reviewed_at',
          'category_assignment_reviewed_by'
      ))
      OR
      (TABLE_NAME = 'worker_profiles' AND COLUMN_NAME IN (
          'workspace_code',
          'business_unit_id'
      ))
  )
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE,
       GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS indexed_columns
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND (
      (TABLE_NAME = 'users' AND INDEX_NAME IN (
          'idx_users_primary_workspace',
          'idx_users_category_status'
      ))
      OR
      (TABLE_NAME = 'worker_profiles' AND INDEX_NAME IN (
          'idx_worker_profile_workspace',
          'idx_worker_profile_business_unit'
      ))
      OR TABLE_NAME IN (
          'user_category_assignment_conflicts',
          'worker_category_assignment_conflicts'
      )
  )
GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE
ORDER BY TABLE_NAME, INDEX_NAME;

SELECT CONSTRAINT_NAME, TABLE_NAME, REFERENCED_TABLE_NAME
FROM information_schema.REFERENTIAL_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE()
  AND CONSTRAINT_NAME IN (
      'fk_users_category_reviewer',
      'fk_user_category_conflict_user',
      'fk_user_category_conflict_resolver',
      'fk_worker_profile_business_unit',
      'fk_worker_category_conflict_worker',
      'fk_worker_category_conflict_resolver'
  )
ORDER BY TABLE_NAME, CONSTRAINT_NAME;

SELECT
    SUM(primary_workspace_code = '*' AND category_assignment_status = 'system_admin') AS system_admin_accounts,
    SUM(primary_workspace_code = 'spare_parts' AND category_assignment_status = 'assigned') AS spare_parts_accounts,
    SUM(primary_workspace_code = 'mining' AND category_assignment_status = 'assigned') AS mining_accounts,
    SUM(primary_workspace_code = 'equipment_hire' AND category_assignment_status = 'assigned') AS hire_accounts,
    SUM(category_assignment_status = 'conflict_review') AS user_conflicts,
    SUM(primary_workspace_code IS NULL AND category_assignment_status <> 'conflict_review') AS unexpected_unassigned_accounts
FROM users;

SELECT
    SUM(workspace_code = 'spare_parts') AS spare_parts_workers,
    SUM(workspace_code = 'mining') AS mining_workers,
    SUM(workspace_code = 'equipment_hire') AS hire_workers,
    SUM(workspace_code IS NULL) AS worker_conflicts_or_unassigned
FROM worker_profiles;

SELECT
    (SELECT COUNT(*) FROM user_category_assignment_conflicts WHERE status = 'open') AS open_user_conflicts,
    (SELECT COUNT(*) FROM worker_category_assignment_conflicts WHERE status = 'open') AS open_worker_conflicts,
    (SELECT COUNT(*) FROM users WHERE category_assignment_status = 'conflict_review') AS blocked_user_conflicts,
    (SELECT COUNT(*) FROM worker_profiles WHERE workspace_code IS NULL) AS blocked_worker_conflicts;

SELECT COUNT(*) AS worker_business_unit_mismatches
FROM worker_profiles wp
LEFT JOIN business_units bu ON bu.id = wp.business_unit_id
WHERE (wp.workspace_code IN ('mining', 'equipment_hire') AND bu.code <> wp.workspace_code)
   OR (wp.workspace_code = 'spare_parts' AND wp.business_unit_id IS NOT NULL);
