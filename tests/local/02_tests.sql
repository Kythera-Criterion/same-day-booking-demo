\set ON_ERROR_STOP 0
\pset footer off
\set A '00000000-0000-4000-8000-0000000000a1'
\set B '00000000-0000-4000-8000-0000000000b1'
\set U1 '00000000-0000-4000-8000-000000000001'
\set U2 '00000000-0000-4000-8000-000000000002'

-- 基準時刻：今日の日本時間で、今から1時間以上先かつ9:30以降
select greatest(date_bin('5 minutes', now() + interval '1 hour', timestamptz '2000-01-01'),
                (((now() at time zone 'Asia/Tokyo')::date + time '09:30') at time zone 'Asia/Tokyo')) as base \gset
select (:'base'::timestamptz < public.jst_today_end() - interval '4 hours') as base_ok \gset
\echo 基準時刻 :base / 今日中に収まる :base_ok

-- テスト用の枠（管理者権限で直接作成）
insert into public.slots (id, salon_id, stylist_id, menu_id, start_at, end_at, price) values
  ('5a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', null, 'd1111111-1111-4111-8111-111111111111', :'base'::timestamptz,                        :'base'::timestamptz + interval '60 min', 4500),
  ('5c000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', null, 'd3333331-3333-4333-8333-333333333333', :'base'::timestamptz + interval '30 min',  :'base'::timestamptz + interval '90 min', 4800),
  ('5b000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', null, 'd2222221-2222-4222-8222-222222222222', :'base'::timestamptz + interval '60 min',  :'base'::timestamptz + interval '110 min', 5200);

\echo
\echo '== T1 新規登録でプロフィールが作られる（不正な性別は空になる）'
select display_name, phone, gender from public.profiles order by display_name;

\echo '== T2 ログインしていない人は公開中の枠だけ見られ、予約は見られない'
begin; set local role anon;
select count(*) as 公開中の枠 from public.slots;
select count(*) from public.bookings;
rollback;

\echo '== T3 利用者1が予約できる'
begin; set local role authenticated; set local request.jwt.claim.sub = :'U1';
select status, contact_name, contact_phone from public.book_slot('5a000000-0000-4000-8000-000000000001');
commit;
select status as 枠の状態 from public.slots where id = '5a000000-0000-4000-8000-000000000001';

\echo '== T4 利用者2が同じ枠を予約しようとすると already_booked'
begin; set local role authenticated; set local request.jwt.claim.sub = :'U2';
select public.book_slot('5a000000-0000-4000-8000-000000000001');
rollback;

\echo '== T5 予約済みの枠は、予約した本人とそのサロンだけが見られる'
begin; set local role anon;
select count(*) as 匿名で見える数 from public.slots where id = '5a000000-0000-4000-8000-000000000001'; rollback;
begin; set local role authenticated; set local request.jwt.claim.sub = :'U2';
select count(*) as 利用者2で見える数 from public.slots where id = '5a000000-0000-4000-8000-000000000001'; rollback;
begin; set local role authenticated; set local request.jwt.claim.sub = :'U1';
select count(*) as 利用者1で見える数 from public.slots where id = '5a000000-0000-4000-8000-000000000001'; rollback;

\echo '== T6 サロンAは自店の予約（名前・電話）を見られる。サロンBは見えない'
begin; set local role authenticated; set local request.jwt.claim.sub = :'A';
select contact_name, contact_phone, status from public.bookings; rollback;
begin; set local role authenticated; set local request.jwt.claim.sub = :'B';
select count(*) as サロンBから見える予約 from public.bookings; rollback;

\echo '== T7 利用者2から利用者1の予約は見えない'
begin; set local role authenticated; set local request.jwt.claim.sub = :'U2';
select count(*) as 利用者2から見える予約 from public.bookings; rollback;

\echo '== T8 画面側からのテーブル直接書き込みは拒否される'
begin; set local role authenticated; set local request.jwt.claim.sub = :'A';
insert into public.slots (salon_id, menu_id, start_at, end_at, price)
values ('11111111-1111-4111-8111-111111111111', 'd1111111-1111-4111-8111-111111111111', now() + interval '2 hour', now() + interval '3 hour', 1);
rollback;
begin; set local role authenticated; set local request.jwt.claim.sub = :'U1';
update public.bookings set status = 'completed';
rollback;

\echo '== T9 サロンBはサロンAのメニューで枠を作れない（forbidden）'
begin; set local role authenticated; set local request.jwt.claim.sub = :'B';
select public.create_slot('d1111111-1111-4111-8111-111111111111', :'base'::timestamptz + interval '2 hour');
rollback;

\echo '== T10 サロンAは今日の枠を作れる（美容師つき）'
begin; set local role authenticated; set local request.jwt.claim.sub = :'A';
select status, price, (start_at at time zone 'Asia/Tokyo')::time as 開始
from public.create_slot('d1111111-1111-4111-8111-111111111111', :'base'::timestamptz + interval '2 hour', 'a1111111-1111-4111-8111-111111111111');
commit;

\echo '== T11 同じ美容師の時間が重なる枠は作れない（overlap）'
begin; set local role authenticated; set local request.jwt.claim.sub = :'A';
select public.create_slot('d1111111-1111-4111-8111-111111111111', :'base'::timestamptz + interval '150 min', 'a1111111-1111-4111-8111-111111111111');
rollback;

\echo '== T12 明日の枠は作れない（today_only）／9時前は作れない（outside_hours）'
begin; set local role authenticated; set local request.jwt.claim.sub = :'A';
select public.create_slot('d1111111-1111-4111-8111-111111111111', :'base'::timestamptz + interval '1 day');
rollback;
begin; set local role authenticated; set local request.jwt.claim.sub = :'A';
select public.create_slot('d1111111-1111-4111-8111-111111111111',
  (((now() at time zone 'Asia/Tokyo')::date + time '08:00') at time zone 'Asia/Tokyo'));
rollback;

\echo '== T13 女性限定のサロンに、男性の利用者は予約できない（not_accepted）'
begin; set local role authenticated; set local request.jwt.claim.sub = :'U2';
select public.book_slot('5c000000-0000-4000-8000-000000000001');
rollback;

\echo '== T14 開始10分前を過ぎた枠は予約できない（too_late）'
begin;
alter table public.slots drop constraint slots_business_hours;
insert into public.slots (id, salon_id, menu_id, start_at, end_at, price) values
  ('5a000000-0000-4000-8000-0000000000ff', '11111111-1111-4111-8111-111111111111', 'd1111111-1111-4111-8111-111111111111', now() + interval '5 min', now() + interval '65 min', 4500);
set local role authenticated; set local request.jwt.claim.sub = :'U2';
select public.book_slot('5a000000-0000-4000-8000-0000000000ff');
rollback;

\echo '== T15 無断キャンセルが90日で2回になると予約できない（suspended）'
begin;
alter table public.slots drop constraint slots_business_hours;
insert into public.slots (id, salon_id, menu_id, start_at, end_at, price, status) values
  ('5a000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'd1111111-1111-4111-8111-111111111111', now() - interval '3 hour', now() - interval '2 hour', 4500, 'booked'),
  ('5a000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'd1111111-1111-4111-8111-111111111111', now() - interval '90 min', now() - interval '30 min', 4500, 'booked');
insert into public.bookings (id, slot_id, user_id, contact_name, contact_phone) values
  ('b0000000-0000-4000-8000-0000000000e1', '5a000000-0000-4000-8000-0000000000e1', :'U2', '鈴木 一郎', '090-0000-0002'),
  ('b0000000-0000-4000-8000-0000000000e2', '5a000000-0000-4000-8000-0000000000e2', :'U2', '鈴木 一郎', '090-0000-0002');
set local role authenticated; set local request.jwt.claim.sub = :'A';
select status from public.salon_update_booking('b0000000-0000-4000-8000-0000000000e1', 'no_show');
select status from public.salon_update_booking('b0000000-0000-4000-8000-0000000000e2', 'no_show');
set local request.jwt.claim.sub = :'U2';
select public.book_slot('5b000000-0000-4000-8000-000000000001');
rollback;

\echo '== T16 開始前の予約に無断キャンセルは記録できない（not_started）'
begin; set local role authenticated; set local request.jwt.claim.sub = :'A';
select b.id as booking_id from public.bookings b where b.slot_id = '5a000000-0000-4000-8000-000000000001' \gset
select public.salon_update_booking(:'booking_id', 'no_show');
rollback;

\echo '== T17 サロンBはサロンAの予約を操作できない（forbidden）'
begin; set local role authenticated; set local request.jwt.claim.sub = :'B';
select public.salon_update_booking(:'booking_id', 'cancel');
rollback;

\echo '== T18 サロン都合のキャンセル → 枠が戻り、別の利用者が予約できる'
begin; set local role authenticated; set local request.jwt.claim.sub = :'A';
select status from public.salon_update_booking(:'booking_id', 'cancel');
commit;
select status as キャンセル後の枠 from public.slots where id = '5a000000-0000-4000-8000-000000000001';
begin; set local role authenticated; set local request.jwt.claim.sub = :'U2';
select status, contact_name from public.book_slot('5a000000-0000-4000-8000-000000000001');
commit;
select count(*) filter (where status = 'confirmed') as 有効な予約, count(*) as 予約の履歴 from public.bookings where slot_id = '5a000000-0000-4000-8000-000000000001';

\echo '== T19 無断キャンセル記録と操作記録は画面側から見えない'
begin; set local role authenticated; set local request.jwt.claim.sub = :'A';
select count(*) from public.no_show_records;
rollback;
begin; set local role authenticated; set local request.jwt.claim.sub = :'A';
select count(*) from public.audit_logs;
rollback;

\echo '== T20 他人のプロフィール（性別など）は、サロンからも見えない'
begin; set local role authenticated; set local request.jwt.claim.sub = :'A';
select count(*) as サロンAから見えるプロフィール from public.profiles;
rollback;

\echo '== T21 操作記録が残っている'
select action, count(*) from public.audit_logs group by action order by action;
