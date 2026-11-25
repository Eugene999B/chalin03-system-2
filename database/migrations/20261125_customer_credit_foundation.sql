-- Additive schema only. Apply in staging first, not automatically on startup.
CREATE TABLE IF NOT EXISTS customer_credit_profiles (
  customer_id INT NOT NULL PRIMARY KEY,
  score TINYINT UNSIGNED NOT NULL DEFAULT 30,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_credit_profile_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  CONSTRAINT chk_credit_score CHECK (score BETWEEN 0 AND 100)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customer_credit_settings (
  branch_id INT NOT NULL PRIMARY KEY,
  term_months TINYINT UNSIGNED NOT NULL DEFAULT 1,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_by INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_credit_settings_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT chk_credit_term CHECK (term_months BETWEEN 1 AND 12)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customer_credit_score_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  previous_score TINYINT UNSIGNED NOT NULL,
  new_score TINYINT UNSIGNED NOT NULL,
  reason VARCHAR(500) NOT NULL,
  actor_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_credit_event_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  CONSTRAINT chk_credit_event_scores CHECK (previous_score <= 100 AND new_score <= 100),
  INDEX idx_credit_event_customer (customer_id, id)
) ENGINE=InnoDB;

-- Backfill all existing canonical customer records. Preserve previously set scores.
INSERT INTO customer_credit_profiles (customer_id)
SELECT c.id FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM customer_credit_profiles p WHERE p.customer_id = c.id)
ON DUPLICATE KEY UPDATE customer_id = customer_credit_profiles.customer_id;

INSERT INTO customer_credit_settings (branch_id)
SELECT b.id FROM branches b
WHERE NOT EXISTS (SELECT 1 FROM customer_credit_settings s WHERE s.branch_id = b.id)
ON DUPLICATE KEY UPDATE branch_id = customer_credit_settings.branch_id;
