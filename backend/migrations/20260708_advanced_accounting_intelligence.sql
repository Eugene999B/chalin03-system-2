-- Chalin 03 Advanced Accounting & Audit Intelligence
-- Safe migration: adds optional tables only. It does not delete or reset data.

CREATE TABLE IF NOT EXISTS accounting_snapshots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  branch_id INT NULL,
  scope_mode VARCHAR(30) NOT NULL DEFAULT 'selected_branch',
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  audit_score INT NOT NULL DEFAULT 0,
  audit_status VARCHAR(30) NOT NULL DEFAULT 'needs_review',
  total_sales DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  total_paid DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  total_balance DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  total_expenses DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  estimated_net_before_stock_cost DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  total_debt_balance DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  stock_cost_value DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  stock_retail_value DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  payload_json LONGTEXT NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_accounting_snapshots_branch_period (branch_id, period_start, period_end),
  INDEX idx_accounting_snapshots_status (audit_status),
  CONSTRAINT fk_accounting_snapshots_branch
    FOREIGN KEY (branch_id) REFERENCES branches(id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS audit_intelligence_findings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  branch_id INT NULL,
  snapshot_id INT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  severity VARCHAR(20) NOT NULL,
  category VARCHAR(80) NOT NULL,
  title VARCHAR(160) NOT NULL,
  detail TEXT NULL,
  recommended_action TEXT NULL,
  score_impact INT NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  assigned_to INT NULL,
  resolved_by INT NULL,
  resolved_at DATETIME NULL,
  resolution_note TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_audit_findings_branch_period (branch_id, period_start, period_end),
  INDEX idx_audit_findings_status (status),
  INDEX idx_audit_findings_severity (severity),
  CONSTRAINT fk_audit_findings_branch
    FOREIGN KEY (branch_id) REFERENCES branches(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_audit_findings_snapshot
    FOREIGN KEY (snapshot_id) REFERENCES accounting_snapshots(id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS management_ledger_snapshots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  branch_id INT NULL,
  snapshot_id INT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  account_code VARCHAR(30) NOT NULL,
  account_name VARCHAR(160) NOT NULL,
  account_type VARCHAR(60) NOT NULL,
  debit DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  credit DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  explanation TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ledger_snapshots_branch_period (branch_id, period_start, period_end),
  INDEX idx_ledger_snapshots_account (account_code),
  CONSTRAINT fk_ledger_snapshots_branch
    FOREIGN KEY (branch_id) REFERENCES branches(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_ledger_snapshots_snapshot
    FOREIGN KEY (snapshot_id) REFERENCES accounting_snapshots(id)
    ON DELETE SET NULL
);
