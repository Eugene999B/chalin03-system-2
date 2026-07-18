-- CHALIN 03 RELEASE 3F-C2
-- Independent business-category login, permission and worker boundaries.
-- Safe conflict review: ambiguous users/workers are preserved and blocked pending
-- an explicit System Administrator decision. No business record is deleted.
-- Production rule: apply this additive migration only. Never run database/schema.sql.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

SET @release3fc2_already_applied = (
    SELECT COUNT(*)
    FROM schema_migrations
    WHERE migration_name = 'release3fc2_category_isolation_guides_receipts_workers'
);

DROP PROCEDURE IF EXISTS chalin03_release3fc2_add_column;
DROP PROCEDURE IF EXISTS chalin03_release3fc2_add_index;
DROP PROCEDURE IF EXISTS chalin03_release3fc2_add_fk;
DROP PROCEDURE IF EXISTS chalin03_release3fc2_backfill;

DELIMITER $$

CREATE PROCEDURE chalin03_release3fc2_add_column(
    IN p_table_name VARCHAR(64),
    IN p_column_name VARCHAR(64),
    IN p_column_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND COLUMN_NAME = p_column_name
    ) THEN
        SET @release3fc2_sql = CONCAT(
            'ALTER TABLE `', p_table_name, '` ADD COLUMN ', p_column_definition
        );
        PREPARE release3fc2_statement FROM @release3fc2_sql;
        EXECUTE release3fc2_statement;
        DEALLOCATE PREPARE release3fc2_statement;
    END IF;
END$$

CREATE PROCEDURE chalin03_release3fc2_add_index(
    IN p_table_name VARCHAR(64),
    IN p_index_name VARCHAR(64),
    IN p_index_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND INDEX_NAME = p_index_name
    ) THEN
        SET @release3fc2_sql = CONCAT(
            'ALTER TABLE `', p_table_name, '` ADD ', p_index_definition
        );
        PREPARE release3fc2_statement FROM @release3fc2_sql;
        EXECUTE release3fc2_statement;
        DEALLOCATE PREPARE release3fc2_statement;
    END IF;
END$$

CREATE PROCEDURE chalin03_release3fc2_add_fk(
    IN p_table_name VARCHAR(64),
    IN p_constraint_name VARCHAR(64),
    IN p_constraint_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND CONSTRAINT_NAME = p_constraint_name
    ) THEN
        SET @release3fc2_sql = CONCAT(
            'ALTER TABLE `', p_table_name, '` ADD CONSTRAINT `',
            p_constraint_name, '` ', p_constraint_definition
        );
        PREPARE release3fc2_statement FROM @release3fc2_sql;
        EXECUTE release3fc2_statement;
        DEALLOCATE PREPARE release3fc2_statement;
    END IF;
END$$

CREATE PROCEDURE chalin03_release3fc2_backfill()
BEGIN
    IF @release3fc2_already_applied = 0 THEN
        DROP TEMPORARY TABLE IF EXISTS release3fc2_user_category_candidates;
        CREATE TEMPORARY TABLE release3fc2_user_category_candidates AS
        SELECT DISTINCT uba_sp.user_id, 'spare_parts' AS workspace_code
        FROM user_branch_access uba_sp
        WHERE uba_sp.can_access = TRUE

        UNION

        SELECT DISTINCT uba.user_id, bu.code AS workspace_code
        FROM user_business_access uba
        INNER JOIN business_units bu ON bu.id = uba.business_unit_id
        WHERE uba.can_access = TRUE
          AND bu.code IN ('mining', 'equipment_hire');

        DROP TEMPORARY TABLE IF EXISTS release3fc2_user_categories;
        CREATE TEMPORARY TABLE release3fc2_user_categories AS
        SELECT
            u.id AS user_id,
            COUNT(DISTINCT candidate.workspace_code) AS managed_category_count,
            MAX(candidate.workspace_code) AS single_managed_category,
            GROUP_CONCAT(
                DISTINCT candidate.workspace_code
                ORDER BY candidate.workspace_code
                SEPARATOR ', '
            ) AS managed_categories
        FROM users u
        LEFT JOIN release3fc2_user_category_candidates candidate
            ON candidate.user_id = u.id
        GROUP BY u.id;

        UPDATE users
        SET primary_workspace_code = '*',
            category_assignment_status = 'system_admin',
            category_conflict_reason = NULL,
            category_assignment_reviewed_at = COALESCE(category_assignment_reviewed_at, NOW()),
            category_assignment_reviewed_by = NULL
        WHERE role = 'admin'
          AND id = 1
          AND LOWER(username) = 'admin';

        UPDATE users u
        INNER JOIN release3fc2_user_categories category_state
            ON category_state.user_id = u.id
        SET u.primary_workspace_code = CASE
                WHEN category_state.managed_category_count = 0 THEN 'spare_parts'
                WHEN category_state.managed_category_count = 1 THEN category_state.single_managed_category
                ELSE NULL
            END,
            u.category_assignment_status = CASE
                WHEN category_state.managed_category_count <= 1 THEN 'assigned'
                ELSE 'conflict_review'
            END,
            u.category_conflict_reason = CASE
                WHEN category_state.managed_category_count > 1 THEN CONCAT(
                    'Multiple active category assignments preserved for review: ',
                    COALESCE(category_state.managed_categories, 'unknown')
                )
                ELSE NULL
            END,
            u.category_assignment_reviewed_at = CASE
                WHEN category_state.managed_category_count <= 1 THEN NOW()
                ELSE NULL
            END,
            u.category_assignment_reviewed_by = NULL
        WHERE NOT (
            u.role = 'admin'
            AND u.id = 1
            AND LOWER(u.username) = 'admin'
        );

        INSERT INTO user_category_assignment_conflicts (
            user_id,
            detected_categories,
            conflict_reason,
            status,
            detected_at
        )
        SELECT
            u.id,
            category_state.managed_categories,
            CONCAT(
                'The account had more than one active managed business category. ',
                'Access was preserved but login is blocked until the original System Administrator chooses one category.'
            ),
            'open',
            NOW()
        FROM users u
        INNER JOIN release3fc2_user_categories category_state
            ON category_state.user_id = u.id
        WHERE category_state.managed_category_count > 1
          AND NOT (
              u.role = 'admin'
              AND u.id = 1
              AND LOWER(u.username) = 'admin'
          )
        ON DUPLICATE KEY UPDATE
            detected_categories = VALUES(detected_categories),
            conflict_reason = VALUES(conflict_reason),
            status = 'open',
            detected_at = VALUES(detected_at),
            resolved_at = NULL,
            resolved_by = NULL,
            resolution_reason = NULL,
            retained_workspace_code = NULL;

        DROP TEMPORARY TABLE IF EXISTS release3fc2_worker_candidates;
        CREATE TEMPORARY TABLE release3fc2_worker_candidates AS
        SELECT worker_id, workspace_code
        FROM (
            SELECT
                wp.id AS worker_id,
                CASE
                    WHEN u.category_assignment_status = 'assigned'
                     AND u.primary_workspace_code IN ('spare_parts', 'mining', 'equipment_hire')
                    THEN u.primary_workspace_code
                    ELSE NULL
                END AS workspace_code
            FROM worker_profiles wp
            LEFT JOIN users u ON u.id = wp.user_id

            UNION ALL

            SELECT
                wa.worker_id,
                CASE
                    WHEN wa.workspace_code IN ('spare_parts', 'mining', 'equipment_hire')
                    THEN wa.workspace_code
                    ELSE NULL
                END AS workspace_code
            FROM worker_assignments wa
            WHERE wa.is_active = TRUE
        ) candidates
        WHERE workspace_code IS NOT NULL;

        DROP TEMPORARY TABLE IF EXISTS release3fc2_worker_categories;
        CREATE TEMPORARY TABLE release3fc2_worker_categories AS
        SELECT
            wp.id AS worker_id,
            COUNT(DISTINCT candidate.workspace_code) AS category_count,
            MAX(candidate.workspace_code) AS single_category,
            GROUP_CONCAT(
                DISTINCT candidate.workspace_code
                ORDER BY candidate.workspace_code
                SEPARATOR ', '
            ) AS detected_categories
        FROM worker_profiles wp
        LEFT JOIN release3fc2_worker_candidates candidate
            ON candidate.worker_id = wp.id
        GROUP BY wp.id;

        UPDATE worker_profiles wp
        INNER JOIN release3fc2_worker_categories category_state
            ON category_state.worker_id = wp.id
        LEFT JOIN business_units bu
            ON bu.code = CASE
                WHEN category_state.category_count = 0 THEN 'spare_parts'
                WHEN category_state.category_count = 1 THEN category_state.single_category
                ELSE NULL
            END
        SET wp.workspace_code = CASE
                WHEN category_state.category_count = 0 THEN 'spare_parts'
                WHEN category_state.category_count = 1 THEN category_state.single_category
                ELSE NULL
            END,
            wp.business_unit_id = CASE
                WHEN category_state.category_count = 1
                 AND category_state.single_category IN ('mining', 'equipment_hire')
                THEN bu.id
                ELSE NULL
            END,
            wp.updated_at = wp.updated_at
        WHERE category_state.category_count <= 1;

        UPDATE worker_profiles wp
        INNER JOIN release3fc2_worker_categories category_state
            ON category_state.worker_id = wp.id
        SET wp.workspace_code = NULL,
            wp.business_unit_id = NULL,
            wp.updated_at = wp.updated_at
        WHERE category_state.category_count > 1;

        INSERT INTO worker_category_assignment_conflicts (
            worker_id,
            detected_categories,
            conflict_reason,
            status,
            detected_at
        )
        SELECT
            wp.id,
            category_state.detected_categories,
            CONCAT(
                'The worker profile was linked to more than one business category. ',
                'All historical assignments were preserved pending System Administrator review.'
            ),
            'open',
            NOW()
        FROM worker_profiles wp
        INNER JOIN release3fc2_worker_categories category_state
            ON category_state.worker_id = wp.id
        WHERE category_state.category_count > 1
        ON DUPLICATE KEY UPDATE
            detected_categories = VALUES(detected_categories),
            conflict_reason = VALUES(conflict_reason),
            status = 'open',
            detected_at = VALUES(detected_at),
            resolved_at = NULL,
            resolved_by = NULL,
            resolution_reason = NULL,
            retained_workspace_code = NULL;

        DROP TEMPORARY TABLE IF EXISTS release3fc2_worker_categories;
        DROP TEMPORARY TABLE IF EXISTS release3fc2_worker_candidates;
        DROP TEMPORARY TABLE IF EXISTS release3fc2_user_categories;
        DROP TEMPORARY TABLE IF EXISTS release3fc2_user_category_candidates;
    END IF;
END$$

DELIMITER ;

CALL chalin03_release3fc2_add_column(
    'users',
    'primary_workspace_code',
    '`primary_workspace_code` VARCHAR(50) NULL AFTER `token_version`'
);
CALL chalin03_release3fc2_add_column(
    'users',
    'category_assignment_status',
    '`category_assignment_status` VARCHAR(30) NOT NULL DEFAULT ''assigned'' AFTER `primary_workspace_code`'
);
CALL chalin03_release3fc2_add_column(
    'users',
    'category_conflict_reason',
    '`category_conflict_reason` VARCHAR(500) NULL AFTER `category_assignment_status`'
);
CALL chalin03_release3fc2_add_column(
    'users',
    'category_assignment_reviewed_at',
    '`category_assignment_reviewed_at` DATETIME NULL AFTER `category_conflict_reason`'
);
CALL chalin03_release3fc2_add_column(
    'users',
    'category_assignment_reviewed_by',
    '`category_assignment_reviewed_by` INT NULL AFTER `category_assignment_reviewed_at`'
);

CALL chalin03_release3fc2_add_index(
    'users',
    'idx_users_primary_workspace',
    'INDEX `idx_users_primary_workspace` (`primary_workspace_code`, `is_active`)'
);
CALL chalin03_release3fc2_add_index(
    'users',
    'idx_users_category_status',
    'INDEX `idx_users_category_status` (`category_assignment_status`, `is_active`)'
);
CALL chalin03_release3fc2_add_fk(
    'users',
    'fk_users_category_reviewer',
    'FOREIGN KEY (`category_assignment_reviewed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL'
);

CREATE TABLE IF NOT EXISTS user_category_assignment_conflicts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    detected_categories VARCHAR(255) NOT NULL,
    conflict_reason VARCHAR(1000) NOT NULL,
    status ENUM('open', 'resolved') NOT NULL DEFAULT 'open',
    detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME NULL,
    resolved_by INT NULL,
    retained_workspace_code VARCHAR(50) NULL,
    resolution_reason VARCHAR(1000) NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_user_category_conflict_user (user_id),
    INDEX idx_user_category_conflict_status (status, detected_at),
    INDEX idx_user_category_conflict_resolver (resolved_by, resolved_at),

    CONSTRAINT fk_user_category_conflict_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_category_conflict_resolver
        FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
);

CALL chalin03_release3fc2_add_column(
    'worker_profiles',
    'workspace_code',
    '`workspace_code` VARCHAR(50) NULL AFTER `user_id`'
);
CALL chalin03_release3fc2_add_column(
    'worker_profiles',
    'business_unit_id',
    '`business_unit_id` INT NULL AFTER `workspace_code`'
);
CALL chalin03_release3fc2_add_index(
    'worker_profiles',
    'idx_worker_profile_workspace',
    'INDEX `idx_worker_profile_workspace` (`workspace_code`, `employment_status`, `full_name`)'
);
CALL chalin03_release3fc2_add_index(
    'worker_profiles',
    'idx_worker_profile_business_unit',
    'INDEX `idx_worker_profile_business_unit` (`business_unit_id`, `employment_status`)'
);
CALL chalin03_release3fc2_add_fk(
    'worker_profiles',
    'fk_worker_profile_business_unit',
    'FOREIGN KEY (`business_unit_id`) REFERENCES `business_units` (`id`) ON DELETE SET NULL'
);

CREATE TABLE IF NOT EXISTS worker_category_assignment_conflicts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    worker_id BIGINT NOT NULL,
    detected_categories VARCHAR(255) NOT NULL,
    conflict_reason VARCHAR(1000) NOT NULL,
    status ENUM('open', 'resolved') NOT NULL DEFAULT 'open',
    detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME NULL,
    resolved_by INT NULL,
    retained_workspace_code VARCHAR(50) NULL,
    resolution_reason VARCHAR(1000) NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_worker_category_conflict_worker (worker_id),
    INDEX idx_worker_category_conflict_status (status, detected_at),
    INDEX idx_worker_category_conflict_resolver (resolved_by, resolved_at),

    CONSTRAINT fk_worker_category_conflict_worker
        FOREIGN KEY (worker_id) REFERENCES worker_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_worker_category_conflict_resolver
        FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
);

CALL chalin03_release3fc2_backfill();

INSERT INTO schema_migrations (migration_name, description)
SELECT
    'release3fc2_category_isolation_guides_receipts_workers',
    'Adds independent category login/permission/worker boundaries, safe conflict review evidence, category-specific guides and branch receipt MoMo configuration.'
WHERE @release3fc2_already_applied = 0;

DROP PROCEDURE IF EXISTS chalin03_release3fc2_backfill;
DROP PROCEDURE IF EXISTS chalin03_release3fc2_add_fk;
DROP PROCEDURE IF EXISTS chalin03_release3fc2_add_index;
DROP PROCEDURE IF EXISTS chalin03_release3fc2_add_column;
