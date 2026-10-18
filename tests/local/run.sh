#!/usr/bin/env bash
# ローカルのPostgreSQL（16以上）で、データベースの動きをまとめて確認する
# 使い方: PSQL="psql -h localhost -p 5432 -U postgres" ./run.sh
# 日本時間の 0時〜19時ごろに実行すること（今日の枠しか作れないため）
set -eu
: "${PSQL:?PSQL を指定してください（例: psql -h localhost -p 5432 -U postgres）}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/../.."

$PSQL -X -q -d postgres -c "drop database if exists demo" -c "create database demo"
DB="$PSQL -X -q -v ON_ERROR_STOP=1 -d demo"
$DB -f "$HERE/00_mock_supabase.sql"
$DB -f "$HERE/00_helpers.sql"
$DB -f "$ROOT/supabase/migrations/0001_init.sql"
$DB -f "$ROOT/supabase/seed.sql"

# 追加のマイグレーションは、2回流しても壊れないことも確かめる
for round in 1 2; do
  $DB -f "$ROOT/supabase/migrations/0002_rules.sql"
  $DB -f "$ROOT/supabase/migrations/0003_automation.sql"
  $DB -f "$ROOT/supabase/migrations/0004_demo.sql"
  $DB -f "$ROOT/supabase/migrations/0005_ui.sql"
  $DB -f "$ROOT/supabase/migrations/0006_polish.sql"
  $DB -f "$ROOT/supabase/migrations/0007_salon_lifecycle.sql"
  $DB -f "$ROOT/supabase/migrations/0008_listing_visibility.sql"
  $DB -f "$ROOT/supabase/migrations/0009_registration.sql"
  $DB -f "$ROOT/supabase/migrations/0010_salon_multi.sql"
  $DB -f "$ROOT/supabase/migrations/0011_demo_anytime.sql"
  $DB -f "$ROOT/supabase/migrations/0012_completion.sql"
  $DB -f "$ROOT/supabase/migrations/0013_salon_signup_approval.sql"
  $DB -f "$ROOT/supabase/migrations/0014_salon_joined.sql"
  $DB -f "$ROOT/supabase/migrations/0015_listing_closed_event.sql"
  $DB -f "$ROOT/supabase/migrations/0016_usage_visits.sql"
  $DB -f "$ROOT/supabase/migrations/0017_usage_events.sql"
  $DB -f "$ROOT/supabase/migrations/0018_signup_notices.sql"
  $DB -f "$ROOT/supabase/migrations/0019_demo_beauty_menus.sql"
  $DB -f "$ROOT/supabase/migrations/0020_salon_features.sql"
  $DB -f "$ROOT/supabase/migrations/0021_delete_staff_menus.sql"
  $DB -f "$ROOT/supabase/seed_0002.sql"
done
echo "追加のマイグレーションを2回流しても、エラーはありませんでした"

$DB -f "$HERE/01_users.sql"

echo "===== 動作確認 ====="
# 途中の出力は捨て、想定外のエラー（stderr）と判定の一覧だけを出す
$PSQL -X -q -d demo -f "$HERE/02_tests.sql" > /dev/null
$PSQL -X -q -d demo <<'EOF'
\pset footer off
select n as "#", case when ok then '✔' else '✘' end as 結果, name as 確認, case when ok then '' else detail end as 詳細
from t.results order by n;
select count(*) filter (where ok) as 合格, count(*) filter (where not ok) as 不合格 from t.results;
EOF
FAILED=$($PSQL -X -q -t -A -d demo -c "select count(*) from t.results where not ok")

echo "===== 同時予約の確認 ====="
PSQL="$PSQL -d demo" "$HERE/03_concurrency.sh"
FAILED_C=$($PSQL -X -q -t -A -d demo -c "select count(*) from t.results where not ok")

if [ "$FAILED" != "0" ] || [ "$FAILED_C" != "0" ]; then
  echo "不合格の確認があります"
  exit 1
fi
echo "すべての確認に合格しました"
