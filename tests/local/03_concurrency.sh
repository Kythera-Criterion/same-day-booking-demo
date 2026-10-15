#!/usr/bin/env bash
# 同じ枠に2人が同時に予約したときの動きを確認する
# 使い方: PSQL="psql -h <host> -p <port> -U postgres -d demo" ./03_concurrency.sh
set -u
: "${PSQL:?PSQL を指定してください（例: psql -h localhost -p 5432 -U postgres -d demo）}"
P="$PSQL -X -q"

SLOT=5a000000-0000-4000-8000-0000000000c1
$P -c "delete from public.bookings where slot_id = '$SLOT'; delete from public.slots where id = '$SLOT';"
$P -c "insert into public.slots (id, salon_id, menu_id, start_at, end_at, price)
       values ('$SLOT', '11111111-1111-4111-8111-111111111111', 'd1111111-1111-4111-8111-111111111111',
               greatest(date_bin('5 minutes', now() + interval '1 hour', timestamptz '2000-01-01'),
                        (((now() at time zone 'Asia/Tokyo')::date + time '09:30') at time zone 'Asia/Tokyo')),
               greatest(date_bin('5 minutes', now() + interval '2 hour', timestamptz '2000-01-01'),
                        (((now() at time zone 'Asia/Tokyo')::date + time '10:30') at time zone 'Asia/Tokyo')),
               4500)"

# 利用者1：予約したあと、わざと3秒間確定を遅らせる
( $P <<EOF 2>&1 | sed 's/^/[利用者1] /' ) &
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select '予約処理開始 ' || clock_timestamp()::time(0) as log;
select '結果: ' || status || ' (' || contact_name || ')' as log from public.book_slot('$SLOT');
select pg_sleep(3);
select '確定 ' || clock_timestamp()::time(0) as log;
commit;
EOF

sleep 1

# 利用者2：1秒後に同じ枠を予約する
( $P <<EOF 2>&1 | sed 's/^/[利用者2] /' ) &
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select '予約処理開始 ' || clock_timestamp()::time(0) as log;
select '結果: ' || status as log from public.book_slot('$SLOT');
commit;
EOF

wait
$P -c "select count(*) as この枠の有効な予約数 from public.bookings where slot_id = '$SLOT' and status <> 'cancelled_by_salon'"
