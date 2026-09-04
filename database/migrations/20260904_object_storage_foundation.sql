-- CHALIN 03 OBJECT STORAGE FOUNDATION
-- Additive only. Existing file payloads remain usable until an explicit migration is run.
-- Do not delete legacy payload columns during this foundation release.

DELIMITER $$

DROP PROCEDURE IF EXISTS chalin03_object_storage_add_column$$

CREATE PROCEDURE chalin03_object_storage_add_column(
    IN p_table_name VARCHAR(64),
    IN p_column_name VARCHAR(64),
    IN p_column_definition TEXT
)
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND COLUMN_NAME = p_column_name
    ) THEN
        SET @object_storage_sql = CONCAT(
            'ALTER TABLE `', p_table_name, '` ADD COLUMN ', p_column_definition
        );
        PREPARE object_storage_statement FROM @object_storage_sql;
        EXECUTE object_storage_statement;
        DEALLOCATE PREPARE object_storage_statement;
    END IF;
END$$

DELIMITER ;

CALL chalin03_object_storage_add_column(
    'equipment_media',
    'storage_provider',
    'VARCHAR(40) NULL AFTER storage_key'
);

CALL chalin03_object_storage_add_column(
    'equipment_media',
    'storage_bucket',
    'VARCHAR(255) NULL AFTER storage_provider'
);

CALL chalin03_object_storage_add_column(
    'equipment_media',
    'storage_status',
    "VARCHAR(20) NULL AFTER storage_bucket"
);

CALL chalin03_object_storage_add_column(
    'equipment_finance_private_documents',
    'storage_provider',
    'VARCHAR(40) NULL AFTER content_checksum'
);

CALL chalin03_object_storage_add_column(
    'equipment_finance_private_documents',
    'storage_bucket',
    'VARCHAR(255) NULL AFTER storage_provider'
);

CALL chalin03_object_storage_add_column(
    'equipment_finance_private_documents',
    'storage_key',
    'VARCHAR(1200) NULL AFTER storage_bucket'
);

CALL chalin03_object_storage_add_column(
    'equipment_finance_private_documents',
    'storage_etag',
    'VARCHAR(255) NULL AFTER storage_key'
);

CALL chalin03_object_storage_add_column(
    'equipment_finance_private_documents',
    'storage_status',
    'VARCHAR(20) NULL AFTER storage_etag'
);

CALL chalin03_object_storage_add_column(
    'equipment_finance_private_documents',
    'stored_at',
    'DATETIME NULL AFTER storage_status'
);

DROP PROCEDURE IF EXISTS chalin03_object_storage_add_column;

INSERT INTO schema_migrations (migration_name, description)
SELECT
    'chalin03_object_storage_foundation',
    'Additive metadata columns for S3-compatible object storage without removing legacy payloads.'
WHERE EXISTS (
    SELECT 1
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'schema_migrations'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
