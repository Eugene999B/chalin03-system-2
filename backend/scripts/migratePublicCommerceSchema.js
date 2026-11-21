"use strict";
// Railway pre-deploy, create-only public commerce schema. The POS, product
// quantity, receipts and financial tables are intentionally NEVER modified.
const {pool}=require("../config/db");
const schema=[
`CREATE TABLE IF NOT EXISTS website_catalog_controls (
 product_id INT NOT NULL PRIMARY KEY,
 branch_id INT NOT NULL,
 is_visible TINYINT(1) NOT NULL DEFAULT 1,
 is_featured TINYINT(1) NOT NULL DEFAULT 0,
 category_override VARCHAR(100) NULL,
 description VARCHAR(600) NULL,
 image_url MEDIUMTEXT NULL,
 updated_by INT NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 KEY idx_web_controls_branch (branch_id,is_visible,is_featured)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS website_customer_requests (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 reference_code VARCHAR(40) NOT NULL,
 client_key VARCHAR(64) NOT NULL,
 request_type ENUM('parts_order','equipment_enquiry','service_enquiry','message') NOT NULL,
 status ENUM('new','contacted','quoted','cancelled','fulfilled') NOT NULL DEFAULT 'new',
 customer_name VARCHAR(150) NOT NULL,
 customer_phone VARCHAR(32) NOT NULL,
 customer_location VARCHAR(255) NOT NULL,
 customer_email VARCHAR(190) NULL,
 subject VARCHAR(180) NULL,
 message TEXT NULL,
 branch_id INT NOT NULL DEFAULT 1,
 estimated_total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
 linked_sale_id INT NULL,
 payment_method ENUM('cash','momo','bank') NULL,
 confirmed_by INT NULL,
 confirmed_at DATETIME NULL,
 assigned_to INT NULL,
 reviewed_by INT NULL,
 reviewed_at DATETIME NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_web_request_reference(reference_code),
 UNIQUE KEY uq_web_request_client_key(client_key),
 UNIQUE KEY uq_web_request_sale(linked_sale_id),
 KEY idx_web_request_status_created(status,created_at),
 KEY idx_web_request_type_created(request_type,created_at),
 KEY idx_web_request_phone(customer_phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS website_customer_request_items (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 request_id BIGINT UNSIGNED NOT NULL,
 product_id INT NOT NULL,
 product_name_snapshot VARCHAR(200) NOT NULL,
 quantity INT UNSIGNED NOT NULL,
 unit_price_snapshot DECIMAL(14,2) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_web_request_item(request_id,product_id),
 KEY idx_web_request_item_product(product_id),
 CONSTRAINT fk_web_request_item_parent FOREIGN KEY(request_id)
 REFERENCES website_customer_requests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];
async function run(){
 const backup=String(process.env.CHALIN03_SIGNED_BACKUP_CONFIRMED||"").toLowerCase();
 const digest=String(process.env.MIGRATION_BACKUP_SHA256||"").trim();
 if(process.env.NODE_ENV==="production"&&(!["true","yes","1"].includes(backup)||!/^[a-f0-9]{64}$/i.test(digest)))
  throw Error("Public commerce schema requires the existing confirmed signed production backup.");
 const c=await pool.getConnection();
 try{
  const [[db]]=await c.query("SELECT DATABASE() AS name");
  if(!db?.name)throw Error("Website commerce database unavailable.");
  const [[lock]]=await c.query("SELECT GET_LOCK(?,30) AS acquired",["chalin03:website-commerce-schema-v1"]);
  if(Number(lock?.acquired)!==1)throw Error("Website commerce schema migration lock unavailable.");
  try{
   for(const statement of schema)await c.query(statement);
   const [tables]=await c.query(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('website_catalog_controls','website_customer_requests','website_customer_request_items')"
   );
   if(tables.length!==3)throw Error("Website commerce schema verification did not find all 3 tables.");
   console.log("CHALIN03 public commerce schema verified: 3 tables. Existing sales/stock unchanged.");
  }finally{await c.query("SELECT RELEASE_LOCK(?)",["chalin03:website-commerce-schema-v1"]);}
 }finally{c.release();await pool.end();}
}
if(require.main===module)run().catch(error=>{console.error("Public commerce predeploy failed:",error.message);process.exitCode=1;});
module.exports={schema,run};
