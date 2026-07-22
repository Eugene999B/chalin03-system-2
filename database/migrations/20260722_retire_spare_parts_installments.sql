-- CHALIN 03 SPARE PARTS INSTALLMENT RETIREMENT
-- ADDITIVE MIGRATION ONLY.
-- Existing Spare Parts sales and installment history are preserved.
-- New installment business belongs exclusively to Equipment Sales & Hire.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

DELIMITER $$

DROP TRIGGER IF EXISTS trg_spare_parts_installment_retired_sales_insert $$
CREATE TRIGGER trg_spare_parts_installment_retired_sales_insert
BEFORE INSERT ON sales
FOR EACH ROW
BEGIN
    IF LOWER(COALESCE(NEW.payment_type, '')) = 'installment' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Spare Parts installment sales have moved to Equipment Sales & Hire.';
    END IF;
END $$

DROP TRIGGER IF EXISTS trg_spare_parts_installment_retired_agreement_insert $$
CREATE TRIGGER trg_spare_parts_installment_retired_agreement_insert
BEFORE INSERT ON installment_agreements
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'New Spare Parts installment agreements are retired. Use Equipment Sales & Hire.';
END $$

DELIMITER ;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    '20260722_retire_spare_parts_installments',
    'Retires new Spare Parts installment sales while preserving all historical tables and records. Equipment installments continue in Equipment Sales & Hire.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);

SELECT
    'Spare Parts installment entry retired; historical records preserved.' AS result,
    DATABASE() AS selected_database;
