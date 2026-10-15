#!/usr/bin/env bash
# 同時に来た処理の動きを、2つの接続で確かめる
#   1. 同じ枠に2人が同時に予約 → 1件だけ成立
#   2. 1人が別々の枠へ同時に予約 → 1件だけ成立（has_active_booking）
#   3. 2つの送信処理が同時に送信待ちを取り出す → 同じ通知は1つの処理にしか渡らない
# 使い方: PSQL="psql -h <host> -p <port> -U postgres -d demo" ./03_concurrency.sh
set -u
: "${PSQL:?PSQL を指定してください（例: psql -h localhost -p 5432 -U postgres -d demo）}"
P="$PSQL -X -q"

U1=00000000-0000-4000-8000-000000000001
U2=00000000-0000-4000-8000-000000000002
U7=00000000-0000-4000-8000-000000000007
S1=5a000000-0000-4000-8000-0000000000c1
S2=5a000000-0000-4000-8000-0000000000c2
S3=5b000000-0000-4000-8000-0000000000c3

$P <<EOF
delete from public.bookings where slot_id in ('$S1', '$S2', '$S3');
delete from public.slots where id in ('$S1', '$S2', '$S3');
-- 基準：今から1時間以上先かつ9:30以降
insert into public.slots (id, salon_id, menu_id, start_at, end_at, price)
select v.id, v.salon_id, v.menu_id, b.t + v.off, b.t + v.off + interval '50 min', 4500
from (select greatest(date_bin('5 minutes', now() + interval '1 hour', timestamptz '2000-01-01'),
                      (((now() at time zone 'Asia/Tokyo')::date + time '09:30') at time zone 'Asia/Tokyo')) as t) b,
     (values ('$S1'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'd1111111-1111-4111-8111-111111111111'::uuid, interval '0 min'),
             ('$S2'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'd1111111-1111-4111-8111-111111111111'::uuid, interval '70 min'),
             ('$S3'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, 'd2222221-2222-4222-8222-222222222222'::uuid, interval '70 min')) v(id, salon_id, menu_id, off);
-- これまでのテストで残った予約を閉じる（1アカウント1件のため）
update public.bookings set status = 'completed' where status = 'confirmed' and user_id in ('$U1', '$U2', '$U7');
EOF

# 1つ目の接続：予約したあと、わざと3秒間確定を遅らせる
# 2つ目の接続：1秒後に同じものを処理する
race() {
  local label1=$1 user1=$2 slot1=$3 label2=$4 user2=$5 slot2=$6
  ( $P <<EOF 2>&1 | sed "s/^/[$label1] /" ) &
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$user1';
select '予約処理開始 ' || clock_timestamp()::time(0) as log;
select '結果: ' || status || ' (' || contact_name || ')' as log from public.book_slot('$slot1');
select pg_sleep(3);
select '確定 ' || clock_timestamp()::time(0) as log;
commit;
EOF
  sleep 1
  ( $P <<EOF 2>&1 | sed "s/^/[$label2] /" ) &
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$user2';
select '予約処理開始 ' || clock_timestamp()::time(0) as log;
select '結果: ' || status || ' (' || contact_name || ')' as log from public.book_slot('$slot2');
commit;
EOF
  wait
}

echo "--- 1. 同じ枠に2人が同時に予約"
race 利用者1 $U1 $S1 利用者2 $U2 $S1
$P <<EOF
select t.ok('C1 同じ枠に同時に予約しても、有効な予約は1件だけ',
  (select count(*) from public.bookings where slot_id = '$S1' and status = 'confirmed') = 1);
EOF

echo "--- 2. 1人が別々の枠へ同時に予約"
race 利用者7の1件目 $U7 $S2 利用者7の2件目 $U7 $S3
$P <<EOF
select t.ok('C2 別々の枠へ同時に予約しても、成立は1件だけ',
  (select count(*) from public.bookings where user_id = '$U7' and status = 'confirmed') = 1);
EOF

echo "--- 3. 2つの送信処理が同時に取り出す"
( $P <<EOF 2>&1 | sed "s/^/[送信処理1] /" ) &
begin;
set local role service_role;
create temp table c1 as select id from public.claim_notifications(1);
select '取り出した通知: ' || string_agg(id::text, ',') as log from c1;
insert into t.ctx select 'claimed_by_1', string_agg(id::text, ',') from c1;
select pg_sleep(3);
commit;
EOF
sleep 1
( $P <<EOF 2>&1 | sed "s/^/[送信処理2] /" ) &
begin;
set local role service_role;
create temp table c2 as select id from public.claim_notifications(50);
select '取り出した通知: ' || coalesce(string_agg(id::text, ','), 'なし') as log from c2;
insert into t.ctx select 'claimed_by_2', coalesce(string_agg(id::text, ','), '') from c2;
commit;
EOF
wait
$P <<EOF
select t.ok('C3 同じ通知は1つの送信処理にしか渡らない',
  (select max(attempts) from public.notification_outbox where status = 'sending') = 1
  and (select value from t.ctx where key = 'claimed_by_1') <> ''
  and not (string_to_array((select value from t.ctx where key = 'claimed_by_1'), ',')
           && string_to_array(coalesce((select value from t.ctx where key = 'claimed_by_2'), ''), ',')));
\pset footer off
select n as "#", case when ok then '✔' else '✘' end as 結果, name as 確認, case when ok then '' else detail end as 詳細
from t.results where name like 'C%' order by n;
EOF
