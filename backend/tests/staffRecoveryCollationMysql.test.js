"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {RECOVERY_WINDOW_SQL}=require("../services/staffRecoveryPolicy");
test("recovery comparison uses exact binary account IDs independent of database collation",()=>{
 assert.match(RECOVERY_WINDOW_SQL,/CAST\(a\.entity_id AS BINARY\)=CAST\(CAST\(staff_passwordless_challenges\.user_id AS CHAR CHARACTER SET ascii\) AS BINARY\)/);
});
test("disposable MySQL: mixed collation recovery window excludes prior attempts only for the recovered account",{skip:process.env.CHALIN03_CREDIT_DISPOSABLE_MYSQL!=="true"},async()=>{
 const mysql=require("mysql2/promise");
 const conn=await mysql.createConnection({host:"127.0.0.1",port:3306,user:"credit_ci",password:"credit_ci_fixture",database:"credit_ci_fixture",charset:"utf8mb4_0900_ai_ci"});
 try{
 await conn.query("CREATE TEMPORARY TABLE activity_log (entity_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,entity_type VARCHAR(40),action VARCHAR(80),outcome VARCHAR(20),created_at DATETIME)");
 await conn.query("CREATE TEMPORARY TABLE staff_passwordless_challenges (user_id INT,purpose VARCHAR(20),attempts INT,created_at DATETIME)");
 await conn.query("INSERT INTO activity_log VALUES ('7','user','STAFF_ACCOUNT_SECURITY_RESET','success','2026-11-27 12:00:00'),('8','user','STAFF_ACCOUNT_SECURITY_RESET','failure','2026-11-27 12:00:00'),('09','user','STAFF_ACCOUNT_SECURITY_RESET','success','2026-11-27 12:00:00')");
 await conn.query("INSERT INTO staff_passwordless_challenges VALUES (7,'totp_login',4,'2026-11-27 11:59:00'),(7,'totp_login',2,'2026-11-27 12:01:00'),(8,'totp_login',5,'2026-11-27 11:59:00'),(9,'totp_login',6,'2026-11-27 11:59:00')");
 const query="SELECT COALESCE(SUM(attempts),0) AS n FROM staff_passwordless_challenges WHERE user_id=? AND purpose='totp_login'"+RECOVERY_WINDOW_SQL;
 for(const [id,n] of [[7,2],[8,5],[9,6]]){const [rows]=await conn.query(query,[id]);assert.equal(Number(rows[0].n),n);}
 }finally{await conn.end();}
});
