-- Chalin 03 production multi-store repair script
-- Safe repair for store_id columns after multi-account / multi-branch setup.

CREATE TABLE IF NOT EXISTS stores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  location VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO stores (id, code, name, location, is_active)
VALUES (1, 'MAIN', 'Chalin 03 Main Store', 'Dunkwa Police Barrier', 1)
ON DUPLICATE KEY UPDATE
  code = VALUES(code),
  name = VALUES(name),
  location = VALUES(location),
  is_active = VALUES(is_active);

-- products.store_id
SET @sql := (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products')
    AND NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'store_id'),
    'ALTER TABLE products ADD COLUMN store_id INT NULL',
    'SELECT "products.store_id already exists or products table missing"'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE products SET store_id = 1 WHERE store_id IS NULL;

-- sales.store_id
SET @sql := (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales')
    AND NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales' AND COLUMN_NAME = 'store_id'),
    'ALTER TABLE sales ADD COLUMN store_id INT NULL',
    'SELECT "sales.store_id already exists or sales table missing"'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE sales SET store_id = 1 WHERE store_id IS NULL;

-- customers.store_id
SET @sql := (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers')
    AND NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'store_id'),
    'ALTER TABLE customers ADD COLUMN store_id INT NULL',
    'SELECT "customers.store_id already exists or customers table missing"'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE customers SET store_id = 1 WHERE store_id IS NULL;

-- debts.store_id
SET @sql := (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'debts')
    AND NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'debts' AND COLUMN_NAME = 'store_id'),
    'ALTER TABLE debts ADD COLUMN store_id INT NULL',
    'SELECT "debts.store_id already exists or debts table missing"'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE debts SET store_id = 1 WHERE store_id IS NULL;

-- expenses.store_id
SET @sql := (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'expenses')
    AND NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'expenses' AND COLUMN_NAME = 'store_id'),
    'ALTER TABLE expenses ADD COLUMN store_id INT NULL',
    'SELECT "expenses.store_id already exists or expenses table missing"'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE expenses SET store_id = 1 WHERE store_id IS NULL;

-- activity_logs.store_id
SET @sql := (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activity_logs')
    AND NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activity_logs' AND COLUMN_NAME = 'store_id'),
    'ALTER TABLE activity_logs ADD COLUMN store_id INT NULL',
    'SELECT "activity_logs.store_id already exists or activity_logs table missing"'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE activity_logs SET store_id = 1 WHERE store_id IS NULL;

-- users.store_id
SET @sql := (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users')
    AND NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'store_id'),
    'ALTER TABLE users ADD COLUMN store_id INT NULL',
    'SELECT "users.store_id already exists or users table missing"'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE users SET store_id = 1 WHERE store_id IS NULL;