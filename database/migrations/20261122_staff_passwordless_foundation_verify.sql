-- READ-ONLY PASSWORDLESS SCHEMA VERIFICATION. No INSERT/UPDATE/DELETE/DDL.
SELECT migration_name,applied_at FROM schema_migrations WHERE migration_name='20261122_staff_passwordless_foundation';
SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN
 ('staff_passwordless_identities','staff_passwordless_challenges','staff_passwordless_backup_codes','staff_passwordless_sms_campaign','staff_passwordless_google_links') ORDER BY TABLE_NAME;
SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
 AND ((TABLE_NAME='staff_passwordless_identities' AND COLUMN_NAME IN ('user_id','secret_ciphertext','secret_iv','secret_tag','last_totp_counter'))
 OR (TABLE_NAME='staff_passwordless_challenges' AND COLUMN_NAME IN ('token_digest','purpose','workspace_code','branch_id','sms_pin_digest','expires_at','consumed_at'))
 OR (TABLE_NAME='staff_passwordless_backup_codes' AND COLUMN_NAME IN ('user_id','code_digest','used_at')))
 ORDER BY TABLE_NAME,COLUMN_NAME;
