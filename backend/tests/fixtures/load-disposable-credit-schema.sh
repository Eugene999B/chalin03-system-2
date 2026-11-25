#!/usr/bin/env bash
# Test-only clean schema bootstrap. Never use a network connection, app
# database config, Railway credentials or a production database.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted && "${CHALIN03_CREDIT_DISPOSABLE_MYSQL:-}" == true ]] || { echo "Disposable hosted CI required"; exit 1; }
container="${CREDIT_CI_MYSQL_CONTAINER:-}"
[[ "$container" =~ ^[a-f0-9]{64}$ ]] || { echo "Expected CI service container ID"; exit 1; }
[[ "$(docker inspect --format '{{.Config.Image}}' "$container")" == "mysql:8.4" ]] || { echo "Unexpected MySQL test image"; exit 1; }
# Confirm this is the fixture service before using local root to create
# triggers in its empty database. Do not weaken MySQL server privileges.
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" | grep -Fxq 'MYSQL_DATABASE=credit_ci_fixture'
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" | grep -Fxq 'MYSQL_USER=credit_ci'
count="$(docker exec "$container" mysql -uroot -pcredit_ci_root_fixture -N -B -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='credit_ci_fixture'")"
[[ "$count" == 0 ]] || { echo "Fixture database is not empty"; exit 1; }
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
docker exec -i "$container" mysql -uroot -pcredit_ci_root_fixture credit_ci_fixture < "$root/database/schema.sql"
