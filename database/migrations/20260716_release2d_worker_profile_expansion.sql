-- CHALIN 03 RELEASE 2D WORKER PROFILE EXPANSION
-- Additive personnel-profile, family, emergency-contact and private-file storage.
-- No existing worker or business record is deleted.
-- Do not run database/schema.sql against production.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

DROP PROCEDURE IF EXISTS chalin03_worker_add_column;
DROP PROCEDURE IF EXISTS chalin03_worker_add_index;

DELIMITER $$

CREATE PROCEDURE chalin03_worker_add_column(
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
        SET @worker_column_sql = CONCAT(
            'ALTER TABLE `',
            p_table_name,
            '` ADD COLUMN ',
            p_column_definition
        );

        PREPARE worker_column_statement
        FROM @worker_column_sql;

        EXECUTE worker_column_statement;
        DEALLOCATE PREPARE worker_column_statement;
    END IF;
END$$

CREATE PROCEDURE chalin03_worker_add_index(
    IN p_table_name VARCHAR(64),
    IN p_index_name VARCHAR(64),
    IN p_index_columns VARCHAR(255)
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND INDEX_NAME = p_index_name
    ) THEN
        SET @worker_index_sql = CONCAT(
            'ALTER TABLE `',
            p_table_name,
            '` ADD INDEX `',
            p_index_name,
            '` (',
            p_index_columns,
            ')'
        );

        PREPARE worker_index_statement
        FROM @worker_index_sql;

        EXECUTE worker_index_statement;
        DEALLOCATE PREPARE worker_index_statement;
    END IF;
END$$

DELIMITER ;

CALL chalin03_worker_add_column(
    'worker_profiles',
    'preferred_name',
    'preferred_name VARCHAR(150) NULL AFTER full_name'
);

CALL chalin03_worker_add_column(
    'worker_profiles',
    'date_of_birth',
    'date_of_birth DATE NULL AFTER email'
);

CALL chalin03_worker_add_column(
    'worker_profiles',
    'gender',
    'gender VARCHAR(30) NULL AFTER date_of_birth'
);

CALL chalin03_worker_add_column(
    'worker_profiles',
    'nationality',
    'nationality VARCHAR(80) NULL AFTER gender'
);

CALL chalin03_worker_add_column(
    'worker_profiles',
    'marital_status',
    'marital_status VARCHAR(30) NULL AFTER nationality'
);

CALL chalin03_worker_add_column(
    'worker_profiles',
    'hometown',
    'hometown VARCHAR(150) NULL AFTER marital_status'
);

CALL chalin03_worker_add_column(
    'worker_profiles',
    'residential_address',
    'residential_address TEXT NULL AFTER hometown'
);

CALL chalin03_worker_add_column(
    'worker_profiles',
    'digital_address',
    'digital_address VARCHAR(80) NULL AFTER residential_address'
);

CALL chalin03_worker_add_column(
    'worker_profiles',
    'national_id_type',
    'national_id_type VARCHAR(60) NULL AFTER digital_address'
);

CALL chalin03_worker_add_column(
    'worker_profiles',
    'national_id_number',
    'national_id_number VARCHAR(120) NULL AFTER national_id_type'
);

CALL chalin03_worker_add_column(
    'worker_profiles',
    'national_id_issue_date',
    'national_id_issue_date DATE NULL AFTER national_id_number'
);

CALL chalin03_worker_add_column(
    'worker_profiles',
    'national_id_expiry_date',
    'national_id_expiry_date DATE NULL AFTER national_id_issue_date'
);

CALL chalin03_worker_add_column(
    'worker_profiles',
    'ssnit_number',
    'ssnit_number VARCHAR(80) NULL AFTER national_id_expiry_date'
);

CALL chalin03_worker_add_column(
    'worker_profiles',
    'tin_number',
    'tin_number VARCHAR(80) NULL AFTER ssnit_number'
);

CALL chalin03_worker_add_column(
    'worker_profiles',
    'blood_group',
    'blood_group VARCHAR(20) NULL AFTER tin_number'
);

CALL chalin03_worker_add_column(
    'worker_profiles',
    'medical_notes',
    'medical_notes TEXT NULL AFTER blood_group'
);

CALL chalin03_worker_add_index(
    'worker_profiles',
    'idx_worker_national_id',
    'national_id_type, national_id_number'
);

CALL chalin03_worker_add_index(
    'worker_profiles',
    'idx_worker_date_of_birth',
    'date_of_birth'
);

CALL chalin03_worker_add_index(
    'worker_profiles',
    'idx_worker_digital_address',
    'digital_address'
);

CREATE TABLE IF NOT EXISTS worker_family_members (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    worker_id BIGINT NOT NULL,
    relationship_type VARCHAR(60) NOT NULL,
    full_name VARCHAR(180) NOT NULL,
    phone VARCHAR(30) NULL,
    date_of_birth DATE NULL,
    occupation VARCHAR(150) NULL,
    residential_address TEXT NULL,
    is_dependent BOOLEAN NOT NULL DEFAULT FALSE,
    is_next_of_kin BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT NULL,
    created_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_worker_family_worker
        FOREIGN KEY (worker_id)
        REFERENCES worker_profiles(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_worker_family_created_by
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE SET NULL,

    INDEX idx_worker_family_worker (worker_id),
    INDEX idx_worker_family_relationship (relationship_type),
    INDEX idx_worker_family_dependent (is_dependent),
    INDEX idx_worker_family_next_of_kin (is_next_of_kin)
);

CREATE TABLE IF NOT EXISTS worker_emergency_contacts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    worker_id BIGINT NOT NULL,
    full_name VARCHAR(180) NOT NULL,
    relationship_type VARCHAR(80) NOT NULL,
    primary_phone VARCHAR(30) NOT NULL,
    secondary_phone VARCHAR(30) NULL,
    residential_address TEXT NULL,
    priority_order INT NOT NULL DEFAULT 1,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT NULL,
    created_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_worker_emergency_worker
        FOREIGN KEY (worker_id)
        REFERENCES worker_profiles(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_worker_emergency_created_by
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE SET NULL,

    INDEX idx_worker_emergency_worker (worker_id),
    INDEX idx_worker_emergency_priority (priority_order),
    INDEX idx_worker_emergency_primary (is_primary)
);

CREATE TABLE IF NOT EXISTS worker_private_files (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    worker_id BIGINT NOT NULL,
    file_category VARCHAR(60) NOT NULL,
    title VARCHAR(180) NOT NULL,
    document_type VARCHAR(100) NULL,
    document_number VARCHAR(120) NULL,
    original_filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(120) NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    checksum_sha256 CHAR(64) NOT NULL,
    file_data MEDIUMBLOB NOT NULL,
    related_record_type VARCHAR(80) NULL,
    related_record_id BIGINT NULL,
    issued_date DATE NULL,
    expiry_date DATE NULL,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT NULL,
    uploaded_by INT NULL,
    uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived_by INT NULL,
    archived_at DATETIME NULL,

    CONSTRAINT fk_worker_private_file_worker
        FOREIGN KEY (worker_id)
        REFERENCES worker_profiles(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_worker_private_file_uploaded_by
        FOREIGN KEY (uploaded_by)
        REFERENCES users(id)
        ON DELETE SET NULL,

    CONSTRAINT fk_worker_private_file_archived_by
        FOREIGN KEY (archived_by)
        REFERENCES users(id)
        ON DELETE SET NULL,

    INDEX idx_worker_private_file_worker (worker_id),
    INDEX idx_worker_private_file_category (file_category),
    INDEX idx_worker_private_file_current (
        worker_id,
        file_category,
        is_current,
        is_active
    ),
    INDEX idx_worker_private_file_expiry (expiry_date),
    INDEX idx_worker_private_file_checksum (checksum_sha256)
);

CREATE TABLE IF NOT EXISTS worker_profile_change_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    worker_id BIGINT NOT NULL,
    change_type VARCHAR(80) NOT NULL DEFAULT 'profile_update',
    reason TEXT NULL,
    before_json LONGTEXT NULL,
    after_json LONGTEXT NULL,
    changed_by INT NULL,
    changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_worker_profile_history_worker
        FOREIGN KEY (worker_id)
        REFERENCES worker_profiles(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_worker_profile_history_changed_by
        FOREIGN KEY (changed_by)
        REFERENCES users(id)
        ON DELETE SET NULL,

    INDEX idx_worker_profile_history_worker (worker_id),
    INDEX idx_worker_profile_history_changed (changed_at),
    INDEX idx_worker_profile_history_type (change_type)
);

INSERT INTO schema_migrations (
    migration_name,
    description
)
VALUES (
    'release2d_worker_profile_expansion',
    'Adds expanded personal and national-ID fields, family members, emergency contacts, private photo/document storage and profile change history.'
)
ON DUPLICATE KEY UPDATE
    description = VALUES(description);

DROP PROCEDURE IF EXISTS chalin03_worker_add_column;
DROP PROCEDURE IF EXISTS chalin03_worker_add_index;