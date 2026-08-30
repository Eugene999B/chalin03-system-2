-- CHALIN 03 EQUIPMENT FINANCE LATE-FEE POLICY
-- ADDITIVE ONLY. No existing finance records are deleted or rewritten.

ALTER TABLE equipment_finance_settings
  ADD COLUMN default_week_interval_weeks TINYINT NOT NULL DEFAULT 1,
  ADD COLUMN late_fee_trigger_mode ENUM('each_missed_installment','after_final_due_plus_grace') NOT NULL DEFAULT 'each_missed_installment',
  ADD COLUMN late_fee_decision_mode ENUM('automatic','boss_approval') NOT NULL DEFAULT 'automatic';

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
