"use strict";
// Railway pre-deploy, create-only public commerce schema. The POS, product
// quantity, receipts and financial tables are intentionally NEVER modified.
const mysql=require("mysql2/promise");
require("dotenv").config();
// Controlled PREDEPLOY migration intentionally opens a direct DDL connection.
// The production runtime pool suppresses CREATE TABLE IF NOT EXISTS and must
// never be used to apply schema changes.
function configuration(){
 const val=(primary,secondary)=>process.env[primary]||process.env[secondary];
 const host=val("DB_HOST","MYSQLHOST"),user=val("DB_USER","MYSQLUSER");
 const password=val("DB_PASSWORD","MYSQLPASSWORD"),database=val("DB_NAME","MYSQLDATABASE");
 if(!host||!user||!password||!database)throw Error("Approved migration database identity unavailable.");
 const ssl=String(process.env.DB_SSL||"").toLowerCase()==="true"?
   process.env.DB_SSL_CA_BASE64?{ca:Buffer.from(process.env.DB_SSL_CA_BASE64,"base64").toString("utf8"),rejectUnauthorized:true}:
   {rejectUnauthorized:!["false","0","off","no"].includes(String(process.env.DB_SSL_REJECT_UNAUTHORIZED||"true").toLowerCase())}:undefined;
 return {host,user,password,database,ssl,port:Number(val("DB_PORT","MYSQLPORT")||3306),connectTimeout:15000};
}
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS website_catalog_photos (
 product_id INT NOT NULL PRIMARY KEY,
 branch_id INT NOT NULL,
 image_url MEDIUMTEXT NOT NULL,
 status ENUM('verified_exact','honest_reference') NOT NULL,
 source_url VARCHAR(1000) NULL,
 owner VARCHAR(180) NOT NULL,
 license VARCHAR(300) NOT NULL,
 evidence VARCHAR(600) NOT NULL,
 sha256 CHAR(64) NOT NULL,
 updated_by INT NOT NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_web_catalog_photo_hash (branch_id,sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];
async function run(){
 const backup=String(process.env.CHALIN03_SIGNED_BACKUP_CONFIRMED||"").toLowerCase();
 const digest=String(process.env.MIGRATION_BACKUP_SHA256||"").trim();
 if(process.env.NODE_ENV==="production"&&(!["true","yes","1"].includes(backup)||!/^[a-f0-9]{64}$/i.test(digest)))
  throw Error("Public commerce schema requires the existing confirmed signed production backup.");
 const expected=configuration();
 const c=await mysql.createConnection(expected);
 try{
  const [[db]]=await c.query("SELECT DATABASE() AS name");
  if(!db?.name||db.name!==expected.database)throw Error("Website commerce migration database identity mismatch.");
  const [[lock]]=await c.query("SELECT GET_LOCK(?,30) AS acquired",["chalin03:website-commerce-schema-v1"]);
  if(Number(lock?.acquired)!==1)throw Error("Website commerce schema migration lock unavailable.");
  try{
   for(const statement of schema)await c.query(statement);
   const [tables]=await c.query(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('website_catalog_controls','website_customer_requests','website_customer_request_items','website_catalog_photos')"
   );
   if(tables.length!==schema.length)throw Error("Website commerce schema verification did not find all required tables.");
   console.log("CHALIN03 public commerce schema verified. Existing sales and stock unchanged.");
  }finally{await c.query("SELECT RELEASE_LOCK(?)",["chalin03:website-commerce-schema-v1"]);}
 }finally{await c.end();}
}
if(require.main===module)run().catch(error=>{console.error("Public commerce predeploy failed:",error.message);process.exitCode=1;});
module.exports={schema,run};
