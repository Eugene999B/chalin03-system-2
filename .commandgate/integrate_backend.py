from __future__ import annotations

import json
from pathlib import Path

ROOT = Path('.').resolve()


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')
    print(f'Updated {path}')


def replace_once(content: str, old: str, new: str, label: str) -> str:
    count = content.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    return content.replace(old, new, 1)


def update_auth_routes() -> None:
    path = 'backend/routes/authRoutes.js'
    content = read(path)
    old = 'module.exports = router;\n'
    new = '''router.commandGateAuth = Object.freeze({
  buildUserSelectByWhere,
  createToken,
  isLoginLocked,
  loadUserCategoryState,
  normalizeWorkspaceCode,
  recordSuccessfulLogin,
  resolveLoginBranch,
  resolveLoginWorkspace,
});

module.exports = router;
'''
    if 'router.commandGateAuth = Object.freeze({' not in content:
        content = replace_once(content, old, new, 'authRoutes export contract')
    write(path, content)


def update_server() -> None:
    path = 'backend/server.js'
    content = read(path)

    if 'const passkeyRoutes = require("./routes/passkeyRoutes");' not in content:
        content = replace_once(
            content,
            'const authRoutes = require("./routes/authRoutes");\n',
            'const authRoutes = require("./routes/authRoutes");\nconst passkeyRoutes = require("./routes/passkeyRoutes");\n',
            'server passkey import',
        )

    if 'const { ensurePasskeySchema } = require("./services/passkeySchemaService");' not in content:
        content = replace_once(
            content,
            'const { startInstallmentReminderScheduler } = require("./services/installmentReminderService");\n',
            'const { startInstallmentReminderScheduler } = require("./services/installmentReminderService");\nconst { ensurePasskeySchema } = require("./services/passkeySchemaService");\n',
            'server passkey schema import',
        )

    if '"/api/auth/passkeys",' not in content:
        content = replace_once(
            content,
            '      "/api/auth",\n',
            '      "/api/auth",\n      "/api/auth/passkeys",\n',
            'server API route list',
        )

    if 'app.use("/api/auth/passkeys/authentication", loginLimiter);' not in content:
        content = replace_once(
            content,
            'app.use("/api/auth/login", loginLimiter);\n',
            'app.use("/api/auth/login", loginLimiter);\napp.use("/api/auth/passkeys/authentication", loginLimiter);\n',
            'server passkey limiter',
        )

    if 'app.use("/api/auth/passkeys", passkeyRoutes);' not in content:
        content = replace_once(
            content,
            'app.use("/api/auth", authRoutes);\n',
            'app.use("/api/auth", authRoutes);\napp.use("/api/auth/passkeys", passkeyRoutes);\n',
            'server passkey mount',
        )

    if 'await ensurePasskeySchema();' not in content:
        content = replace_once(
            content,
            '    await ensureEmploymentDocumentSchema();\n',
            '    await ensureEmploymentDocumentSchema();\n    await ensurePasskeySchema();\n',
            'server passkey startup schema',
        )

    write(path, content)


def update_packages() -> None:
    packages = [
        ('backend/package.json', '@simplewebauthn/server', '^13.3.2'),
        ('frontend/package.json', '@simplewebauthn/browser', '^13.3.0'),
    ]

    for path, dependency, version in packages:
        data = json.loads(read(path))
        dependencies = data.setdefault('dependencies', {})
        dependencies[dependency] = version
        data['dependencies'] = dict(sorted(dependencies.items()))
        write(path, json.dumps(data, indent=2) + '\n')


def update_migration() -> None:
    migration = '''-- CHALIN 03 COMMAND GATE PASSKEY SECURITY
-- ADDITIVE MIGRATION ONLY.
-- Existing business records are preserved.
-- BACKUP REQUIRED: verify the latest Railway/MySQL database backup and Chalin 03 full-system backup before production execution.
-- Never run database/schema.sql against production.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

CREATE TABLE IF NOT EXISTS user_passkeys (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    webauthn_user_id VARCHAR(128) NOT NULL,
    credential_id VARCHAR(512) NOT NULL,
    public_key LONGBLOB NOT NULL,
    counter BIGINT UNSIGNED NOT NULL DEFAULT 0,
    device_type VARCHAR(32) NULL,
    backed_up TINYINT(1) NOT NULL DEFAULT 0,
    transports VARCHAR(255) NULL,
    display_name VARCHAR(120) NOT NULL DEFAULT 'Trusted device',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP NULL DEFAULT NULL,
    revoked_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_user_passkeys_credential (credential_id(255)),
    KEY idx_user_passkeys_user (user_id, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS passkey_challenges (
    id CHAR(36) NOT NULL,
    purpose VARCHAR(32) NOT NULL,
    user_id BIGINT UNSIGNED NULL,
    challenge VARCHAR(512) NOT NULL,
    context_json TEXT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_passkey_challenges_expiry (expires_at, used_at),
    KEY idx_passkey_challenges_user (user_id, purpose)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_migrations (migration_name, description)
SELECT
    '20260722_command_gate_passkeys',
    'Add compact WebAuthn passkey credentials and one-time authentication challenges.'
WHERE NOT EXISTS (
    SELECT 1
    FROM schema_migrations
    WHERE migration_name = '20260722_command_gate_passkeys'
);
'''
    verify = '''-- Read-only verification for 20260722_command_gate_passkeys.sql.

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
'''
    write('database/migrations/20260722_command_gate_passkeys.sql', migration)
    write('database/migrations/20260722_command_gate_passkeys_verify.sql', verify)


def update_contract_test() -> None:
    path = 'backend/tests/passkeyRouteContract.test.js'
    content = read(path)
    addition = '''

test("auth routes expose only the helpers required by Command Gate", () => {
  const source = read("routes/authRoutes.js");

  assert.match(source, /router\.commandGateAuth\s*=\s*Object\.freeze/);
  assert.match(source, /resolveLoginWorkspace/);
  assert.match(source, /resolveLoginBranch/);
  assert.match(source, /createToken/);
});

test("passkey dependencies are declared for backend and browser", () => {
  const backendPackage = JSON.parse(read("package.json"));
  const frontendPackage = JSON.parse(
    fs.readFileSync(path.resolve(root, "../frontend/package.json"), "utf8")
  );

  assert.ok(backendPackage.dependencies["@simplewebauthn/server"]);
  assert.ok(frontendPackage.dependencies["@simplewebauthn/browser"]);
});
'''
    if 'auth routes expose only the helpers required by Command Gate' not in content:
        content += addition
    write(path, content)


def main() -> None:
    update_auth_routes()
    update_server()
    update_packages()
    update_migration()
    update_contract_test()


if __name__ == '__main__':
    main()
