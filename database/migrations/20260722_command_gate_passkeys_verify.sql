-- Read-only verification for 20260722_command_gate_passkeys.sql.

SELECT migration_name, applied_at, description
FROM schema_migrations
WHERE migration_name = '20260722_command_gate_passkeys';

SELECT table_name, table_rows, engine
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN ('user_passkeys', 'passkey_challenges')
ORDER BY table_name;

SELECT table_name, column_name, column_type, is_nullable
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name IN ('user_passkeys', 'passkey_challenges')
ORDER BY table_name, ordinal_position;
