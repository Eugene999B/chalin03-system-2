-- CHALIN ONE DOCUMENT INTELLIGENCE
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: Professional Backup and separate SQL backup must be verified before production execution.
-- Raw binary documents, passwords, provider secrets, access tokens and database credentials must never be stored here.
-- Documents remain bound to an exact governed knowledge version and are retrievable only after that exact version is published.

CREATE TABLE IF NOT EXISTS ai_knowledge_documents (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    source_id BIGINT UNSIGNED NOT NULL,
    version_id BIGINT UNSIGNED NOT NULL,
    document_key VARCHAR(160) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(120) NOT NULL,
    content_sha256 CHAR(64) NOT NULL,
    content_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    parser_key VARCHAR(80) NOT NULL,
    parser_version VARCHAR(40) NOT NULL DEFAULT '1',
    parse_status ENUM('pending','parsed','rejected','failed') NOT NULL DEFAULT 'pending',
    extracted_text MEDIUMTEXT NULL,
    extracted_character_count INT UNSIGNED NOT NULL DEFAULT 0,
    extracted_line_count INT UNSIGNED NOT NULL DEFAULT 0,
    chunk_count INT UNSIGNED NOT NULL DEFAULT 0,
    raw_binary_stored TINYINT(1) NOT NULL DEFAULT 0,
    source_locator VARCHAR(700) NULL,
    metadata_json JSON NULL,
    ingested_by INT NULL,
    parsed_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_ai_knowledge_document_key (version_id, document_key),
    UNIQUE KEY uq_ai_knowledge_document_content (version_id, content_sha256),
    KEY idx_ai_knowledge_document_source (source_id, version_id, parse_status),
    KEY idx_ai_knowledge_document_parser (parser_key, parse_status, created_at),
    CONSTRAINT chk_ai_knowledge_document_no_raw_binary CHECK (raw_binary_stored = 0),
    CONSTRAINT fk_ai_knowledge_document_source
        FOREIGN KEY (source_id) REFERENCES ai_knowledge_sources(id) ON DELETE CASCADE,
    CONSTRAINT fk_ai_knowledge_document_version
        FOREIGN KEY (version_id) REFERENCES ai_knowledge_versions(id) ON DELETE CASCADE,
    CONSTRAINT fk_ai_knowledge_document_ingested_by
        FOREIGN KEY (ingested_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_knowledge_chunks (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    document_id BIGINT UNSIGNED NOT NULL,
    source_id BIGINT UNSIGNED NOT NULL,
    version_id BIGINT UNSIGNED NOT NULL,
    chunk_index INT UNSIGNED NOT NULL,
    heading_path VARCHAR(700) NULL,
    line_start INT UNSIGNED NULL,
    line_end INT UNSIGNED NULL,
    char_start INT UNSIGNED NOT NULL DEFAULT 0,
    char_end INT UNSIGNED NOT NULL DEFAULT 0,
    chunk_text MEDIUMTEXT NOT NULL,
    chunk_sha256 CHAR(64) NOT NULL,
    token_estimate INT UNSIGNED NOT NULL DEFAULT 0,
    vector_model_key VARCHAR(80) NOT NULL DEFAULT 'local_hash_v1',
    vector_json JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_ai_knowledge_chunk_position (document_id, chunk_index),
    UNIQUE KEY uq_ai_knowledge_chunk_checksum (document_id, chunk_sha256),
    KEY idx_ai_knowledge_chunk_version (version_id, chunk_index),
    KEY idx_ai_knowledge_chunk_source (source_id, version_id),
    KEY idx_ai_knowledge_chunk_vector_model (vector_model_key, version_id),
    CONSTRAINT fk_ai_knowledge_chunk_document
        FOREIGN KEY (document_id) REFERENCES ai_knowledge_documents(id) ON DELETE CASCADE,
    CONSTRAINT fk_ai_knowledge_chunk_source
        FOREIGN KEY (source_id) REFERENCES ai_knowledge_sources(id) ON DELETE CASCADE,
    CONSTRAINT fk_ai_knowledge_chunk_version
        FOREIGN KEY (version_id) REFERENCES ai_knowledge_versions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    '20260807_chalin_one_document_intelligence',
    'Additive governed document-ingestion, deterministic chunk locator and local vector-retrieval foundation for CHALIN ONE knowledge.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
