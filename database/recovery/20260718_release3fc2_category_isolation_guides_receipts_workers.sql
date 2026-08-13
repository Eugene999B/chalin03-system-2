-- CHALIN 03 STAGING BACKUP RECOVERY — RELEASE 3F-C2
-- Schema-only recovery form of release3fc2_category_isolation_guides_receipts_workers.
--
-- The historical migration also backfilled users and worker profiles and wrote
-- conflict-review rows. Staging recovery must not replay those business-data
-- mutations because the signed production backup is the authoritative row set.
-- This file restores only the schema contract required before data restore.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

DROP PROCEDURE IF EXISTS chalin03_recovery_release3fc2_add_column;
DROP PROCEDURE IF EXISTS chalin03_recovery_release3fc2_add_index;
DROP PROCEDURE IF EXISTS chalin03_recovery_release3fc2_add_fk;

DELIMITER $$

CREATE PROCEDURE chalin03_recovery_release3fc2_add_column(
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
        SET @release3fc2_recovery_sql = CONCAT(
            'ALTER TABLE `', p_table_name, '` ADD COLUMN ', p_column_definition
        );
        PREPARE release3fc2_recovery_statement FROM @release3fc2_recovery_sql;
        EXECUTE release3fc2_recovery_statement;
        DEALLOCATE PREPARE release3fc2_recovery_statement;
    END IF;
END$$

CREATE PROCEDURE chalin03_recovery_release3fc2_add_index(
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
        SET @release3fc2_recovery_sql = CONCAT(
            'ALTER TABLE `', p_table_name, '` ADD ', p_index_definition
        );
        PREPARE release3fc2_recovery_statement FROM @release3fc2_recovery_sql;
        EXECUTE release3fc2_recovery_statement;
        DEALLOCATE PREPARE release3fc2_recovery_statement;
    END IF;
END$$

CREATE PROCEDURE chalin03_recovery_release3fc2_add_fk(
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
        SET @release3fc2_recovery_sql = CONCAT(
            'ALTER TABLE `', p_table_name, '` ADD CONSTRAINT `',
            p_constraint_name, '` ', p_constraint_definition
        );
        PREPARE release3fc2_recovery_statement FROM @release3fc2_recovery_sql;
        EXECUTE release3fc2_recovery_statement;
        DEALLOCATE PREPARE release3fc2_recovery_statement;
    END IF;
END$$

DELIMITER ;

CALL chalin03_recovery_release3fc2_add_column(
    'users',
    'primary_workspace_code',
    '`primary_workspace_code` VARCHAR(50) NULL AFTER `token_version`'
);
CALL chalin03_recovery_release3fc2_add_column(
    'users',
    'category_assignment_status',
    '`category_assignment_status` VARCHAR(30) NOT NULL DEFAULT ''assigned'' AFTER `primary_workspace_code`'
);
CALL chalin03_recovery_release3fc2_add_column(
    'users',
    'category_conflict_reason',
    '`category_conflict_reason` VARCHAR(500) NULL AFTER `category_assignment_status`'
);
CALL chalin03_recovery_release3fc2_add_column(
    'users',
    'category_assignment_reviewed_at',
    '`category_assignment_reviewed_at` DATETIME NULL AFTER `category_conflict_reason`'
);
CALL chalin03_recovery_release3fc2_add_column(
    'users',
    'category_assignment_reviewed_by',
    '`category_assignment_reviewed_by` INT NULL AFTER `category_assignment_reviewed_at`'
);

CALL chalin03_recovery_release3fc2_add_index(
    'users',
    'idx_users_primary_workspace',
    'INDEX `idx_users_primary_workspace` (`primary_workspace_code`, `is_active`)'
);
CALL chalin03_recovery_release3fc2_add_index(
    'users',
    'idx_users_category_status',
    'INDEX `idx_users_category_status` (`category_assignment_status`, `is_active`)'
);
CALL chalin03_recovery_release3fc2_add_fk(
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

CALL chalin03_recovery_release3fc2_add_column(
    'worker_profiles',
    'workspace_code',
    '`workspace_code` VARCHAR(50) NULL AFTER `user_id`'
);
CALL chalin03_recovery_release3fc2_add_column(
    'worker_profiles',
    'business_unit_id',
    '`business_unit_id` INT NULL AFTER `workspace_code`'
);
CALL chalin03_recovery_release3fc2_add_index(
    'worker_profiles',
    'idx_worker_profile_workspace',
    'INDEX `idx_worker_profile_workspace` (`workspace_code`, `employment_status`, `full_name`)'
);
CALL chalin03_recovery_release3fc2_add_index(
    'worker_profiles',
    'idx_worker_profile_business_unit',
    'INDEX `idx_worker_profile_business_unit` (`business_unit_id`, `employment_status`)'
);
CALL chalin03_recovery_release3fc2_add_fk(
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

DROP PROCEDURE IF EXISTS chalin03_recovery_release3fc2_add_fk;
DROP PROCEDURE IF EXISTS chalin03_recovery_release3fc2_add_index;
DROP PROCEDURE IF EXISTS chalin03_recovery_release3fc2_add_column;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    'release3fc2_category_isolation_guides_receipts_workers',
    'Staging recovery schema-only replay of Release 3F-C2 category isolation; historical user/worker backfill intentionally excluded because signed backup rows are authoritative.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
