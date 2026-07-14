-- Stage 6A verification - read-only checks.
-- Run after database/stage6a_group_users_staff_migration.sql.
-- Result sets that list integrity problems should normally return no rows.

SELECT
  'database.selected' AS check_name,
  CASE WHEN DATABASE() IS NOT NULL AND DATABASE() <> '' THEN 'PASS' ELSE 'FAIL' END AS status,
  DATABASE() AS database_name;

SELECT
  'users.required_columns' AS check_name,
  CASE WHEN COUNT(*) = 4 THEN 'PASS' ELSE 'FAIL' END AS status,
  GROUP_CONCAT(COLUMN_NAME ORDER BY COLUMN_NAME) AS found_columns
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'users'
  AND COLUMN_NAME IN (
    'must_change_password',
    'password_changed_at',
    'created_by',
    'password_hash'
  );

SELECT
  'users.role_supports_stage6a' AS check_name,
  CASE
    WHEN COLUMN_TYPE LIKE '%''admin''%'
      AND COLUMN_TYPE LIKE '%''manager''%'
      AND COLUMN_TYPE LIKE '%''staff''%'
      AND COLUMN_TYPE LIKE '%''auditor''%'
      AND COLUMN_TYPE LIKE '%''cashier''%'
    THEN 'PASS'
    ELSE 'FAIL'
  END AS status,
  COLUMN_TYPE AS role_definition
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'users'
  AND COLUMN_NAME = 'role';

SELECT
  'users.duplicate_usernames' AS check_name,
  username,
  COUNT(*) AS duplicate_count
FROM users
GROUP BY username
HAVING COUNT(*) > 1;

SELECT
  'users.no_plain_password_column' AS check_name,
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  GROUP_CONCAT(COLUMN_NAME ORDER BY COLUMN_NAME) AS unsafe_columns
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'users'
  AND COLUMN_NAME IN (
    'password',
    'plain_password',
    'temporary_password',
    'current_password'
  );

SELECT
  'users.active_admin_count' AS check_name,
  CASE WHEN COUNT(*) >= 1 THEN 'PASS' ELSE 'FAIL' END AS status,
  COUNT(*) AS active_admins
FROM users
WHERE role = 'admin'
  AND is_active = TRUE;

SELECT
  'users.inactive_account_summary' AS check_name,
  'INFO' AS status,
  COUNT(*) AS inactive_users,
  'Inactive accounts cannot log in; access rows may remain for historical integrity.' AS note
FROM users
WHERE is_active = FALSE;

SELECT
  'business_units.enabled' AS check_name,
  code,
  name,
  is_enabled
FROM business_units
WHERE code IN ('spare_parts', 'mining', 'equipment_hire')
ORDER BY display_order, code;

SELECT
  'user_business_access.duplicates' AS check_name,
  user_id,
  business_unit_id,
  COUNT(*) AS duplicate_count
FROM user_business_access
GROUP BY user_id, business_unit_id
HAVING COUNT(*) > 1;

SELECT
  'user_business_access.invalid_workspace_roles' AS check_name,
  bu.code,
  uba.user_id,
  u.username,
  u.role AS global_role,
  uba.access_role
FROM user_business_access uba
INNER JOIN business_units bu ON bu.id = uba.business_unit_id
INNER JOIN users u ON u.id = uba.user_id
WHERE (
    bu.code = 'mining'
    AND uba.access_role NOT IN (
      'manager', 'site_supervisor', 'equipment_operator', 'site_clerk',
      'accountant', 'auditor', 'group_admin'
    )
  )
  OR (
    bu.code = 'equipment_hire'
    AND uba.access_role NOT IN (
      'manager', 'hire_officer', 'dispatcher', 'fleet_officer',
      'accountant', 'auditor', 'group_admin'
    )
  );

SELECT
  'user_business_access.multiple_default_workspaces' AS check_name,
  user_id,
  COUNT(*) AS default_count
FROM user_business_access
WHERE is_default = TRUE
GROUP BY user_id
HAVING COUNT(*) > 1;

SELECT
  'user_business_access.cashier_in_mining_or_hire' AS check_name,
  bu.code AS workspace_code,
  u.id,
  u.username,
  uba.access_role,
  uba.can_access
FROM users u
INNER JOIN user_business_access uba ON uba.user_id = u.id
INNER JOIN business_units bu ON bu.id = uba.business_unit_id
WHERE u.role = 'cashier'
  AND bu.code IN ('mining', 'equipment_hire')
  AND uba.can_access = TRUE;

SELECT
  'user_mining_site_access.duplicates' AS check_name,
  user_id,
  site_id,
  COUNT(*) AS duplicate_count
FROM user_mining_site_access
GROUP BY user_id, site_id
HAVING COUNT(*) > 1;

SELECT
  'user_mining_site_access.multiple_defaults' AS check_name,
  user_id,
  COUNT(*) AS default_count
FROM user_mining_site_access
WHERE is_default = TRUE
  AND can_access = TRUE
GROUP BY user_id
HAVING COUNT(*) > 1;

SELECT
  'user_mining_site_access.invalid_default' AS check_name,
  umsa.user_id,
  u.username,
  umsa.site_id,
  ms.site_code,
  ms.site_name,
  umsa.can_access,
  ms.is_active,
  ms.status
FROM user_mining_site_access umsa
INNER JOIN users u ON u.id = umsa.user_id
INNER JOIN mining_sites ms ON ms.id = umsa.site_id
WHERE umsa.is_default = TRUE
  AND (
    umsa.can_access <> TRUE
    OR ms.is_active <> TRUE
    OR ms.status <> 'active'
  );

SELECT
  'user_mining_site_access.active_context_without_workspace' AS check_name,
  umsa.user_id,
  u.username,
  umsa.site_id,
  ms.site_code
FROM user_mining_site_access umsa
INNER JOIN users u ON u.id = umsa.user_id
INNER JOIN mining_sites ms ON ms.id = umsa.site_id
INNER JOIN business_units bu ON bu.code = 'mining'
LEFT JOIN user_business_access uba
  ON uba.user_id = umsa.user_id
 AND uba.business_unit_id = bu.id
WHERE umsa.can_access = TRUE
  AND (uba.id IS NULL OR uba.can_access <> TRUE)
  AND u.role <> 'admin';

SELECT
  'user_hire_location_access.duplicates' AS check_name,
  user_id,
  location_id,
  COUNT(*) AS duplicate_count
FROM user_hire_location_access
GROUP BY user_id, location_id
HAVING COUNT(*) > 1;

SELECT
  'user_hire_location_access.multiple_defaults' AS check_name,
  user_id,
  COUNT(*) AS default_count
FROM user_hire_location_access
WHERE is_default = TRUE
  AND can_access = TRUE
GROUP BY user_id
HAVING COUNT(*) > 1;

SELECT
  'user_hire_location_access.invalid_default' AS check_name,
  uhla.user_id,
  u.username,
  uhla.location_id,
  bl.code,
  bl.name,
  uhla.can_access,
  bl.is_active,
  bu.code AS business_unit_code
FROM user_hire_location_access uhla
INNER JOIN users u ON u.id = uhla.user_id
INNER JOIN business_locations bl ON bl.id = uhla.location_id
INNER JOIN business_units bu ON bu.id = bl.business_unit_id
WHERE uhla.is_default = TRUE
  AND (
    uhla.can_access <> TRUE
    OR bl.is_active <> TRUE
    OR bu.code <> 'equipment_hire'
  );

SELECT
  'user_hire_location_access.cross_workspace_assignment' AS check_name,
  uhla.user_id,
  u.username,
  uhla.location_id,
  bl.code AS location_code,
  bu.code AS business_unit_code
FROM user_hire_location_access uhla
INNER JOIN users u ON u.id = uhla.user_id
INNER JOIN business_locations bl ON bl.id = uhla.location_id
INNER JOIN business_units bu ON bu.id = bl.business_unit_id
WHERE bu.code <> 'equipment_hire';

SELECT
  'user_hire_location_access.active_context_without_workspace' AS check_name,
  uhla.user_id,
  u.username,
  uhla.location_id,
  bl.code AS location_code
FROM user_hire_location_access uhla
INNER JOIN users u ON u.id = uhla.user_id
INNER JOIN business_locations bl ON bl.id = uhla.location_id
INNER JOIN business_units bu_hire ON bu_hire.code = 'equipment_hire'
LEFT JOIN user_business_access uba
  ON uba.user_id = uhla.user_id
 AND uba.business_unit_id = bu_hire.id
WHERE uhla.can_access = TRUE
  AND (uba.id IS NULL OR uba.can_access <> TRUE)
  AND u.role <> 'admin';

SELECT
  'users.created_by_orphans' AS check_name,
  u.id,
  u.username,
  u.created_by
FROM users u
LEFT JOIN users creator ON creator.id = u.created_by
WHERE u.created_by IS NOT NULL
  AND creator.id IS NULL;
