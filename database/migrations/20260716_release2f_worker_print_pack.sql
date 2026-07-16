-- CHALIN 03 RELEASE 2F
-- Professional Worker Profile PDF and Worker ID Card Print Pack.
-- ADDITIVE MIGRATION ONLY.
-- Do not run database/schema.sql against production.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

DROP PROCEDURE IF EXISTS chalin03_worker_print_add_column;
DROP PROCEDURE IF EXISTS chalin03_worker_print_add_index;

DELIMITER $$

CREATE PROCEDURE chalin03_worker_print_add_column(
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
        SET @worker_print_column_sql = CONCAT(
            'ALTER TABLE `',
            p_table_name,
            '` ADD COLUMN ',
            p_column_definition
        );

        PREPARE worker_print_column_statement
        FROM @worker_print_column_sql;

        EXECUTE worker_print_column_statement;
        DEALLOCATE PREPARE worker_print_column_statement;
    END IF;
END$$

CREATE PROCEDURE chalin03_worker_print_add_index(
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
        SET @worker_print_index_sql = CONCAT(
            'ALTER TABLE `',
            p_table_name,
            '` ADD INDEX `',
            p_index_name,
            '` (',
            p_index_columns,
            ')'
        );

        PREPARE worker_print_index_statement
        FROM @worker_print_index_sql;

        EXECUTE worker_print_index_statement;
        DEALLOCATE PREPARE worker_print_index_statement;
    END IF;
END$$

DELIMITER ;

CALL chalin03_worker_print_add_column(
    'worker_profiles',
    'id_card_issue_date',
    'id_card_issue_date DATE NULL AFTER medical_notes'
);

CALL chalin03_worker_print_add_column(
    'worker_profiles',
    'id_card_expiry_date',
    'id_card_expiry_date DATE NULL AFTER id_card_issue_date'
);

CALL chalin03_worker_print_add_column(
    'worker_profiles',
    'id_card_serial',
    'id_card_serial VARCHAR(100) NULL AFTER id_card_expiry_date'
);

CALL chalin03_worker_print_add_index(
    'worker_profiles',
    'idx_worker_id_card_serial',
    'id_card_serial'
);

CALL chalin03_worker_print_add_index(
    'worker_profiles',
    'idx_worker_id_card_expiry',
    'id_card_expiry_date'
);

CREATE TABLE IF NOT EXISTS worker_print_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    worker_id BIGINT NOT NULL,
    document_type VARCHAR(60) NOT NULL,
    print_layout VARCHAR(40) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    generated_by INT NULL,
    request_ip VARCHAR(50) NULL,
    request_user_agent VARCHAR(255) NULL,
    generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_worker_print_history_worker
        FOREIGN KEY (worker_id)
        REFERENCES worker_profiles(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_worker_print_history_user
        FOREIGN KEY (generated_by)
        REFERENCES users(id)
        ON DELETE SET NULL,

    INDEX idx_worker_print_history_worker (
        worker_id,
        generated_at
    ),

    INDEX idx_worker_print_history_type (
        document_type,
        print_layout
    ),

    INDEX idx_worker_print_history_user (
        generated_by,
        generated_at
    )
);

INSERT INTO schema_migrations (
    migration_name,
    description
)
VALUES (
    'release2f_worker_print_pack',
    'Adds professional worker-profile PDFs, exact-size and A4 ID-card layouts, ID-card dates and print-history evidence.'
)
ON DUPLICATE KEY UPDATE
    description = VALUES(description);

DROP PROCEDURE IF EXISTS chalin03_worker_print_add_column;
DROP PROCEDURE IF EXISTS chalin03_worker_print_add_index;