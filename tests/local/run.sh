#!/usr/bin/env bash
# ローカルのPostgreSQL（16以上）で、データベースの動きをまとめて確認する
# 使い方: PSQL="psql -h localhost -p 5432 -U postgres" ./run.sh
set -eu
: "${PSQL:?PSQL を指定してください（例: psql -h localhost -p 5432 -U postgres）}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/../.."

$PSQL -X -q -d postgres -c "drop database if exists demo" -c "create database demo"
DB="$PSQL -X -q -v ON_ERROR_STOP=1 -d demo"
$DB -f "$HERE/00_mock_supabase.sql"
$DB -f "$ROOT/supabase/migrations/0001_init.sql"
$DB -f "$ROOT/supabase/seed.sql"
$DB -f "$HERE/01_users.sql"

echo "===== 動作確認 ====="
$PSQL -X -d demo -f "$HERE/02_tests.sql" 2>&1 \
  | grep -v -E "^(BEGIN|ROLLBACK|COMMIT|SET|INSERT 0 [0-9]+|ALTER TABLE)$"

echo "===== 同時予約の確認 ====="
PSQL="$PSQL -d demo" "$HERE/03_concurrency.sh"
