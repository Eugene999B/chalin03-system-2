-- CHALIN 03 EQUIPMENT FINANCE LATE-FEE POLICY
-- ADDITIVE ONLY. No existing finance records are deleted or rewritten.
-- The application schema guard creates the three Finance Settings columns
-- idempotently when required, so this migration only creates the decision table.

CREATE TABLE IF NOT EXISTS equipment_finance_late_fee_decisions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  agreement_id BIGINT NOT NULL,
  schedule_id BIGINT NOT NULL,
  trigger_mode VARCHAR(60) NOT NULL,
  decision_mode VARCHAR(30) NOT NULL,
  eligible_on DATE NOT NULL,
  proposed_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  basis_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  fee_type VARCHAR(30) NOT NULL DEFAULT 'fixed',
  fee_value DECIMAL(15,4) NOT NULL DEFAULT 0,
  status ENUM('pending','applied','waived') NOT NULL DEFAULT 'pending',
  decided_by INT NULL,
  decided_at DATETIME NULL,
  decision_reason VARCHAR(1000) NULL,
  applied_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_equipment_finance_late_fee_decision (agreement_id, schedule_id, trigger_mode),
  INDEX idx_equipment_finance_late_fee_queue (status, eligible_on),
  INDEX idx_equipment_finance_late_fee_agreement (agreement_id, status)
);
