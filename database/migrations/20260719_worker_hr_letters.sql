-- CHALIN 03 WORKER HR LETTERS
-- Additive production migration. Does not alter or delete existing worker records.

CREATE TABLE IF NOT EXISTS worker_hr_letters (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    worker_id BIGINT NOT NULL,
    workspace_code VARCHAR(50) NOT NULL,
    letter_number VARCHAR(100) NULL,
    letter_type VARCHAR(50) NOT NULL,
    title VARCHAR(180) NOT NULL,
    subject VARCHAR(255) NULL,
    letter_date DATE NOT NULL,
    effective_date DATE NULL,
    response_due_date DATE NULL,
    status ENUM('draft', 'issued', 'acknowledged', 'cancelled') NOT NULL DEFAULT 'draft',
    payload_json JSON NOT NULL,
    signatory_name VARCHAR(150) NOT NULL,
    signatory_title VARCHAR(150) NOT NULL,
    worker_acknowledgement_status ENUM('pending', 'accepted', 'received', 'declined', 'not_required') NOT NULL DEFAULT 'pending',
    worker_acknowledged_name VARCHAR(150) NULL,
    worker_acknowledged_at DATETIME NULL,
    worker_acknowledgement_note TEXT NULL,
    issued_by INT NULL,
    issued_at DATETIME NULL,
    cancelled_by INT NULL,
    cancelled_at DATETIME NULL,
    cancellation_reason VARCHAR(1000) NULL,
    created_by INT NULL,
    updated_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_worker_hr_letter_number (letter_number),
    INDEX idx_worker_hr_letters_worker (worker_id, letter_date),
    INDEX idx_worker_hr_letters_workspace (workspace_code, letter_date),
    INDEX idx_worker_hr_letters_type (letter_type, letter_date),
    INDEX idx_worker_hr_letters_status (status, letter_date),
    INDEX idx_worker_hr_letters_response_due (response_due_date, status),

    CONSTRAINT fk_worker_hr_letters_worker
        FOREIGN KEY (worker_id) REFERENCES worker_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_worker_hr_letters_issued_by
        FOREIGN KEY (issued_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_worker_hr_letters_cancelled_by
        FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_worker_hr_letters_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_worker_hr_letters_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    '20260719_worker_hr_letters',
    'Adds worker-linked employment and HR correspondence records with PDF generation, finalization status and acknowledgement evidence.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);

SELECT 'WORKER HR LETTERS MIGRATION COMPLETE' AS result;
