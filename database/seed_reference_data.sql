-- CHALIN 03 CLEAN MASTER REFERENCE SEED
-- Run after restore. This inserts only missing reference records.

INSERT IGNORE INTO business_units (
    id,
    code,
    name,
    description,
    is_enabled,
    display_order
) VALUES
(1, 'spare_parts', 'Spare Parts', 'Sales, inventory and store operations', TRUE, 1),
(2, 'mining', 'Mining Operations', 'Mining sites, production, fuel and operational control', TRUE, 2),
(3, 'equipment_hire', 'Equipment Hire', 'Excavator and heavy-equipment hire operations', TRUE, 3);

INSERT IGNORE INTO business_locations (
    business_unit_id,
    code,
    name,
    location_type,
    address,
    phone,
    is_active
)
SELECT
    bu.id,
    COALESCE(NULLIF(b.code, ''), b.branch_code),
    b.name,
    'store',
    b.location,
    b.phone,
    b.is_active
FROM branches b
INNER JOIN business_units bu ON bu.code = 'spare_parts';

INSERT IGNORE INTO user_business_access (
    user_id,
    business_unit_id,
    access_role,
    can_access,
    is_default,
    created_by
)
SELECT
    u.id,
    bu.id,
    CASE WHEN u.role = 'admin' THEN 'group_admin' ELSE u.role END,
    TRUE,
    CASE WHEN bu.code = 'spare_parts' THEN TRUE ELSE FALSE END,
    NULL
FROM users u
JOIN business_units bu ON bu.code IN ('spare_parts', 'mining', 'equipment_hire')
WHERE u.role = 'admin'
  AND u.is_active = TRUE;

INSERT IGNORE INTO schema_migrations (migration_name, description) VALUES
('clean_master_database_reset', 'Clean master schema baseline with 53 application tables and schema_migrations'),
('stage6a_group_users_staff', 'Stage 6A central users and staff administration fields'),
('spare_parts_sales_hotfix', 'Spare Parts amount tendered, change due and admin sale edit fields'),
('equipment_hire_part4_5c', 'Equipment Hire Parts 4 through 5C schema baseline'),
('shared_fleet_mining_baseline', 'Shared Fleet and Mining Operations schema baseline');

SELECT 'REFERENCE SEED FINISHED' AS result;
