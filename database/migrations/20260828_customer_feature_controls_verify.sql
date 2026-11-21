-- CHALIN 03 READ-ONLY MIGRATION VERIFICATION
-- This file must never mutate database state.

SELECT
    branch_id,
    customer_identity_editing_enabled,
    customer_merge_enabled,
    updated_at
FROM customer_feature_controls
ORDER BY branch_id;

SELECT
    migration_name,
    description
FROM schema_migrations
WHERE migration_name = 'customer_feature_controls';
