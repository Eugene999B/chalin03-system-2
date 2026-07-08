USE chalin03_db;

CREATE TABLE IF NOT EXISTS stock_transfers (
  id INT AUTO_INCREMENT PRIMARY KEY,

  transfer_number VARCHAR(80) NOT NULL UNIQUE,

  from_branch_id INT NOT NULL,
  to_branch_id INT NOT NULL,

  status ENUM(
    'draft',
    'requested',
    'approved',
    'dispatched',
    'received',
    'cancelled',
    'rejected'
  ) NOT NULL DEFAULT 'requested',

  requested_by INT NULL,
  approved_by INT NULL,
  dispatched_by INT NULL,
  received_by INT NULL,
  cancelled_by INT NULL,
  rejected_by INT NULL,

  request_note TEXT NULL,
  approval_note TEXT NULL,
  dispatch_note TEXT NULL,
  receive_note TEXT NULL,
  cancel_note TEXT NULL,
  reject_note TEXT NULL,

  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at DATETIME NULL,
  dispatched_at DATETIME NULL,
  received_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  rejected_at DATETIME NULL,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_stock_transfers_from_branch (from_branch_id),
  INDEX idx_stock_transfers_to_branch (to_branch_id),
  INDEX idx_stock_transfers_status (status),
  INDEX idx_stock_transfers_requested_at (requested_at),

  CONSTRAINT fk_stock_transfers_from_branch
    FOREIGN KEY (from_branch_id) REFERENCES branches(id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_stock_transfers_to_branch
    FOREIGN KEY (to_branch_id) REFERENCES branches(id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id INT AUTO_INCREMENT PRIMARY KEY,

  transfer_id INT NOT NULL,

  source_product_id INT NOT NULL,
  destination_product_id INT NULL,

  product_name VARCHAR(255) NOT NULL,
  barcode VARCHAR(100) NULL,
  category VARCHAR(100) NULL,
  size VARCHAR(100) NULL,

  requested_quantity INT NOT NULL,
  dispatched_quantity INT NULL,
  received_quantity INT NULL,

  source_quantity_before INT NULL,
  source_quantity_after INT NULL,
  destination_quantity_before INT NULL,
  destination_quantity_after INT NULL,

  item_note TEXT NULL,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_stock_transfer_items_transfer (transfer_id),
  INDEX idx_stock_transfer_items_source_product (source_product_id),
  INDEX idx_stock_transfer_items_destination_product (destination_product_id),
  INDEX idx_stock_transfer_items_barcode (barcode),

  CONSTRAINT fk_stock_transfer_items_transfer
    FOREIGN KEY (transfer_id) REFERENCES stock_transfers(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_stock_transfer_items_source_product
    FOREIGN KEY (source_product_id) REFERENCES products(id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_stock_transfer_items_destination_product
    FOREIGN KEY (destination_product_id) REFERENCES products(id)
    ON DELETE SET NULL
);