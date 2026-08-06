-- Read-only CHALIN ONE external portal security verifier.

SELECT COUNT(*) AS migration_record_count
FROM schema_migrations
WHERE migration_name = '20260806_chalin_one_portal_security_foundation';

SELECT COUNT(*) AS portal_security_table_count
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'portal_accounts',
    'portal_invitations',
    'portal_sessions',
    'portal_access_grants',
    'portal_consent_records',
    'portal_audit_events'
  );

SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'portal_accounts',
    'portal_invitations',
    'portal_sessions',
    'portal_access_grants',
    'portal_consent_records',
    'portal_audit_events'
  )
ORDER BY TABLE_NAME;

SELECT COUNT(*) AS forbidden_raw_identity_column_count
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'portal_accounts',
    'portal_invitations',
    'portal_sessions',
    'portal_access_grants',
    'portal_consent_records',
    'portal_audit_events'
  )
  AND COLUMN_NAME IN (
    'session_token',
    'invitation_token',
    'access_token',
    'refresh_token',
    'jwt',
    'ip_address',
    'user_agent'
  );

SELECT COUNT(*) AS active_portal_session_count
FROM portal_sessions
WHERE session_status = 'active';
