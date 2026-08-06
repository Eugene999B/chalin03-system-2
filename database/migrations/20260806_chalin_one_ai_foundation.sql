-- CHALIN ONE AI FOUNDATION
-- ADDITIVE MIGRATION ONLY.
-- No provider API secret, database credential, access token or password may be stored in these tables.
-- This migration must be executed only through the guarded manual runner.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

CREATE TABLE IF NOT EXISTS ai_provider_profiles (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    profile_key VARCHAR(120) NOT NULL,
    provider_key VARCHAR(80) NOT NULL,
    model_key VARCHAR(160) NOT NULL,
    profile_status ENUM('disabled', 'test', 'staging', 'active', 'archived') NOT NULL DEFAULT 'disabled',
    is_default TINYINT(1) NOT NULL DEFAULT 0,
    configuration_json JSON NULL,
    per_request_token_limit INT UNSIGNED NOT NULL DEFAULT 4000,
    daily_token_limit BIGINT UNSIGNED NOT NULL DEFAULT 100000,
    monthly_cost_limit_micros BIGINT UNSIGNED NOT NULL DEFAULT 0,
    created_by INT NULL,
    updated_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_ai_provider_profile_key (profile_key),
    KEY idx_ai_provider_status_default (profile_status, is_default),
    CONSTRAINT fk_ai_provider_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_ai_provider_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_conversations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    conversation_key VARCHAR(64) NOT NULL,
    persona ENUM('copilot', 'executive', 'guide') NOT NULL,
    user_id INT NULL,
    workspace_code VARCHAR(50) NULL,
    branch_id INT NULL,
    mining_site_id BIGINT UNSIGNED NULL,
    hire_location_id BIGINT UNSIGNED NULL,
    title VARCHAR(220) NULL,
    conversation_status ENUM('active', 'archived', 'blocked') NOT NULL DEFAULT 'active',
    visibility ENUM('private', 'workspace', 'executive', 'public_session') NOT NULL DEFAULT 'private',
    last_message_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_ai_conversation_key (conversation_key),
    KEY idx_ai_conversation_user_status (user_id, conversation_status, updated_at),
    KEY idx_ai_conversation_scope (workspace_code, branch_id, mining_site_id, hire_location_id),
    KEY idx_ai_conversation_persona (persona, visibility),
    CONSTRAINT fk_ai_conversation_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_messages (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    message_key VARCHAR(64) NOT NULL,
    conversation_id BIGINT UNSIGNED NOT NULL,
    message_role ENUM('user', 'assistant', 'system', 'tool') NOT NULL,
    content_text MEDIUMTEXT NULL,
    content_sha256 CHAR(64) NULL,
    safety_status ENUM('pending', 'allowed', 'redacted', 'blocked', 'error') NOT NULL DEFAULT 'pending',
    provider_profile_id BIGINT UNSIGNED NULL,
    provider_key VARCHAR(80) NULL,
    model_key VARCHAR(160) NULL,
    input_tokens INT UNSIGNED NOT NULL DEFAULT 0,
    output_tokens INT UNSIGNED NOT NULL DEFAULT 0,
    cost_micros BIGINT UNSIGNED NOT NULL DEFAULT 0,
    latency_ms INT UNSIGNED NULL,
    finish_reason VARCHAR(80) NULL,
    error_code VARCHAR(120) NULL,
    created_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_ai_message_key (message_key),
    KEY idx_ai_message_conversation (conversation_id, created_at, id),
    KEY idx_ai_message_safety (safety_status, created_at),
    KEY idx_ai_message_provider (provider_key, model_key, created_at),
    CONSTRAINT fk_ai_message_conversation
        FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE,
    CONSTRAINT fk_ai_message_provider_profile
        FOREIGN KEY (provider_profile_id) REFERENCES ai_provider_profiles(id) ON DELETE SET NULL,
    CONSTRAINT fk_ai_message_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_tool_invocations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    invocation_key VARCHAR(64) NOT NULL,
    message_id BIGINT UNSIGNED NULL,
    requested_by INT NULL,
    tool_key VARCHAR(150) NOT NULL,
    tool_version VARCHAR(40) NOT NULL DEFAULT '1',
    persona ENUM('copilot', 'executive', 'guide') NOT NULL,
    risk_level TINYINT UNSIGNED NOT NULL DEFAULT 1,
    workspace_code VARCHAR(50) NULL,
    branch_id INT NULL,
    mining_site_id BIGINT UNSIGNED NULL,
    hire_location_id BIGINT UNSIGNED NULL,
    invocation_status ENUM('requested', 'running', 'succeeded', 'failed', 'blocked') NOT NULL DEFAULT 'requested',
    input_sha256 CHAR(64) NOT NULL,
    input_summary_json JSON NULL,
    output_summary_json JSON NULL,
    permission_snapshot_json JSON NULL,
    evidence_count INT UNSIGNED NOT NULL DEFAULT 0,
    latency_ms INT UNSIGNED NULL,
    error_code VARCHAR(120) NULL,
    error_message VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_ai_tool_invocation_key (invocation_key),
    KEY idx_ai_tool_message (message_id, created_at),
    KEY idx_ai_tool_actor (requested_by, created_at),
    KEY idx_ai_tool_status_risk (invocation_status, risk_level, created_at),
    KEY idx_ai_tool_scope (workspace_code, branch_id, mining_site_id, hire_location_id),
    CONSTRAINT chk_ai_tool_risk CHECK (risk_level BETWEEN 1 AND 5),
    CONSTRAINT fk_ai_tool_message
        FOREIGN KEY (message_id) REFERENCES ai_messages(id) ON DELETE SET NULL,
    CONSTRAINT fk_ai_tool_requested_by
        FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_evidence_records (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    message_id BIGINT UNSIGNED NULL,
    invocation_id BIGINT UNSIGNED NULL,
    source_type VARCHAR(80) NOT NULL,
    source_ref VARCHAR(180) NOT NULL,
    source_version VARCHAR(80) NULL,
    label VARCHAR(255) NOT NULL,
    excerpt_text VARCHAR(1200) NULL,
    as_of_at DATETIME NULL,
    classification ENUM('public', 'internal', 'confidential', 'sensitive', 'immutable') NOT NULL DEFAULT 'internal',
    workspace_code VARCHAR(50) NULL,
    metadata_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_ai_evidence_message (message_id, id),
    KEY idx_ai_evidence_invocation (invocation_id, id),
    KEY idx_ai_evidence_source (source_type, source_ref),
    KEY idx_ai_evidence_scope (workspace_code, classification),
    CONSTRAINT fk_ai_evidence_message
        FOREIGN KEY (message_id) REFERENCES ai_messages(id) ON DELETE CASCADE,
    CONSTRAINT fk_ai_evidence_invocation
        FOREIGN KEY (invocation_id) REFERENCES ai_tool_invocations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_usage_ledger (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    usage_key VARCHAR(64) NOT NULL,
    user_id INT NULL,
    conversation_id BIGINT UNSIGNED NULL,
    message_id BIGINT UNSIGNED NULL,
    provider_key VARCHAR(80) NOT NULL,
    model_key VARCHAR(160) NOT NULL,
    workspace_code VARCHAR(50) NULL,
    input_tokens INT UNSIGNED NOT NULL DEFAULT 0,
    output_tokens INT UNSIGNED NOT NULL DEFAULT 0,
    total_tokens INT UNSIGNED NOT NULL DEFAULT 0,
    cost_micros BIGINT UNSIGNED NOT NULL DEFAULT 0,
    request_id VARCHAR(100) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_ai_usage_key (usage_key),
    KEY idx_ai_usage_user_date (user_id, created_at),
    KEY idx_ai_usage_scope_date (workspace_code, created_at),
    KEY idx_ai_usage_provider_date (provider_key, model_key, created_at),
    CONSTRAINT fk_ai_usage_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_ai_usage_conversation
        FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE SET NULL,
    CONSTRAINT fk_ai_usage_message
        FOREIGN KEY (message_id) REFERENCES ai_messages(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_audit_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    event_key VARCHAR(64) NOT NULL,
    user_id INT NULL,
    conversation_id BIGINT UNSIGNED NULL,
    message_id BIGINT UNSIGNED NULL,
    invocation_id BIGINT UNSIGNED NULL,
    event_type VARCHAR(120) NOT NULL,
    outcome ENUM('success', 'denied', 'blocked', 'failed') NOT NULL DEFAULT 'success',
    severity ENUM('info', 'warning', 'high', 'critical') NOT NULL DEFAULT 'info',
    persona ENUM('copilot', 'executive', 'guide') NULL,
    workspace_code VARCHAR(50) NULL,
    branch_id INT NULL,
    mining_site_id BIGINT UNSIGNED NULL,
    hire_location_id BIGINT UNSIGNED NULL,
    request_id VARCHAR(100) NULL,
    metadata_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_ai_audit_event_key (event_key),
    KEY idx_ai_audit_actor_date (user_id, created_at),
    KEY idx_ai_audit_type_outcome (event_type, outcome, created_at),
    KEY idx_ai_audit_scope (workspace_code, branch_id, mining_site_id, hire_location_id),
    CONSTRAINT fk_ai_audit_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_ai_audit_conversation
        FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE SET NULL,
    CONSTRAINT fk_ai_audit_message
        FOREIGN KEY (message_id) REFERENCES ai_messages(id) ON DELETE SET NULL,
    CONSTRAINT fk_ai_audit_invocation
        FOREIGN KEY (invocation_id) REFERENCES ai_tool_invocations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_prompt_safety_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    safety_event_key VARCHAR(64) NOT NULL,
    user_id INT NULL,
    conversation_id BIGINT UNSIGNED NULL,
    message_id BIGINT UNSIGNED NULL,
    event_type ENUM('prompt_injection', 'secret_request', 'sensitive_data', 'output_violation', 'rate_limit', 'provider_failure', 'other') NOT NULL,
    safety_action ENUM('allowed', 'redacted', 'blocked') NOT NULL,
    pattern_keys_json JSON NULL,
    redaction_count INT UNSIGNED NOT NULL DEFAULT 0,
    input_sha256 CHAR(64) NULL,
    safe_summary VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_ai_safety_event_key (safety_event_key),
    KEY idx_ai_safety_actor_date (user_id, created_at),
    KEY idx_ai_safety_type_action (event_type, safety_action, created_at),
    CONSTRAINT fk_ai_safety_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_ai_safety_conversation
        FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE SET NULL,
    CONSTRAINT fk_ai_safety_message
        FOREIGN KEY (message_id) REFERENCES ai_messages(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_knowledge_sources (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    source_key VARCHAR(120) NOT NULL,
    source_type ENUM('policy', 'manual', 'catalogue', 'procedure', 'faq', 'public_content', 'report', 'other') NOT NULL DEFAULT 'other',
    owner_workspace_code VARCHAR(50) NULL,
    visibility ENUM('public', 'workspace', 'restricted', 'executive') NOT NULL DEFAULT 'workspace',
    title VARCHAR(255) NOT NULL,
    description VARCHAR(1000) NULL,
    source_reference VARCHAR(500) NULL,
    source_status ENUM('draft', 'active', 'archived') NOT NULL DEFAULT 'draft',
    effective_from DATETIME NULL,
    expires_at DATETIME NULL,
    created_by INT NULL,
    updated_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_ai_knowledge_source_key (source_key),
    KEY idx_ai_knowledge_visibility_scope (visibility, owner_workspace_code, source_status),
    KEY idx_ai_knowledge_effective (source_status, effective_from, expires_at),
    CONSTRAINT fk_ai_knowledge_source_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_ai_knowledge_source_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_knowledge_versions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    source_id BIGINT UNSIGNED NOT NULL,
    version_number INT UNSIGNED NOT NULL,
    version_status ENUM('draft', 'in_review', 'approved', 'published', 'superseded', 'archived') NOT NULL DEFAULT 'draft',
    title VARCHAR(255) NOT NULL,
    body_text MEDIUMTEXT NOT NULL,
    checksum_sha256 CHAR(64) NOT NULL,
    metadata_json JSON NULL,
    effective_from DATETIME NULL,
    expires_at DATETIME NULL,
    created_by INT NULL,
    published_by INT NULL,
    published_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_ai_knowledge_version (source_id, version_number),
    KEY idx_ai_knowledge_version_status (source_id, version_status, published_at),
    KEY idx_ai_knowledge_version_effective (version_status, effective_from, expires_at),
    CONSTRAINT fk_ai_knowledge_version_source
        FOREIGN KEY (source_id) REFERENCES ai_knowledge_sources(id) ON DELETE CASCADE,
    CONSTRAINT fk_ai_knowledge_version_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_ai_knowledge_version_published_by
        FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_knowledge_approvals (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    source_id BIGINT UNSIGNED NOT NULL,
    version_id BIGINT UNSIGNED NOT NULL,
    approval_status ENUM('pending', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',
    requested_by INT NULL,
    assigned_to INT NULL,
    decided_by INT NULL,
    request_note VARCHAR(2000) NULL,
    decision_note VARCHAR(2000) NULL,
    requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_at DATETIME NULL,
    executed_at DATETIME NULL,
    PRIMARY KEY (id),
    KEY idx_ai_knowledge_approval_pending (approval_status, assigned_to, requested_at),
    KEY idx_ai_knowledge_approval_version (version_id, approval_status),
    CONSTRAINT fk_ai_knowledge_approval_source
        FOREIGN KEY (source_id) REFERENCES ai_knowledge_sources(id) ON DELETE CASCADE,
    CONSTRAINT fk_ai_knowledge_approval_version
        FOREIGN KEY (version_id) REFERENCES ai_knowledge_versions(id) ON DELETE CASCADE,
    CONSTRAINT fk_ai_knowledge_approval_requested_by
        FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_ai_knowledge_approval_assigned_to
        FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_ai_knowledge_approval_decided_by
        FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_feedback (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    feedback_key VARCHAR(64) NOT NULL,
    conversation_id BIGINT UNSIGNED NOT NULL,
    message_id BIGINT UNSIGNED NOT NULL,
    user_id INT NULL,
    rating ENUM('helpful', 'not_helpful', 'incorrect', 'unsafe') NOT NULL,
    comment_text VARCHAR(2000) NULL,
    correction_text TEXT NULL,
    review_status ENUM('new', 'reviewed', 'accepted', 'rejected') NOT NULL DEFAULT 'new',
    reviewed_by INT NULL,
    reviewed_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_ai_feedback_key (feedback_key),
    KEY idx_ai_feedback_message (message_id, created_at),
    KEY idx_ai_feedback_status (review_status, rating, created_at),
    CONSTRAINT fk_ai_feedback_conversation
        FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE,
    CONSTRAINT fk_ai_feedback_message
        FOREIGN KEY (message_id) REFERENCES ai_messages(id) ON DELETE CASCADE,
    CONSTRAINT fk_ai_feedback_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_ai_feedback_reviewed_by
        FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (migration_name, description)
VALUES (
    '20260806_chalin_one_ai_foundation',
    'Additive CHALIN ONE AI provider, conversation, tool, evidence, usage, safety, knowledge and feedback foundation.'
);
