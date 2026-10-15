-- ローカルの PostgreSQL で、業務ルールと権限をまとめて確かめる
-- 判定は t.results に記録し、最後に一覧と合否の数を出す
-- 日本時間で 0時〜19時ごろに実行すること（今日の枠しか作れないため）
\set ON_ERROR_STOP 1
\pset footer off

-- 利用者・サロン・運営
--   A  = 00000000-0000-4000-8000-0000000000a1  サロンA（HAIR ROOM AOI）のスタッフ
--   B  = 00000000-0000-4000-8000-0000000000b1  サロンB（atelier nagi）のスタッフ
--   AD = 00000000-0000-4000-8000-0000000000ad  運営
--   U1 = ...0001 女性 / U2 = ...0002 男性 / U3 = ...0003 性別不正 / U4 = ...0004 18歳確認なし
--   U5 = ...0005 写真 / U6 = ...0006 無断キャンセル / U7 = ...0007 予備

-- ---------------------------------------------------------
-- 準備
-- ---------------------------------------------------------
-- 基準時刻：今日の日本時間で、今から1時間以上先かつ9:30以降
insert into t.ctx values ('base', (
  select greatest(date_bin('5 minutes', now() + interval '1 hour', timestamptz '2000-01-01'),
                  (((now() at time zone 'Asia/Tokyo')::date + time '09:30') at time zone 'Asia/Tokyo'))::text));
select t.ok('T0 基準時刻から5時間以内が今日に収まる（日本時間19時ごろまでに実行）',
            t.at(300) < public.jst_today_end(), (select value from t.ctx where key = 'base'));

insert into public.slots (id, salon_id, stylist_id, menu_id, start_at, end_at, price) values
  ('5a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', null, 'd1111111-1111-4111-8111-111111111111', t.at(0),   t.at(60),  4500),
  ('5c000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', null, 'd3333331-3333-4333-8333-333333333333', t.at(30),  t.at(90),  4800),
  ('5b000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', null, 'd2222221-2222-4222-8222-222222222222', t.at(60),  t.at(110), 5200),
  ('5a000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', null, 'd1111111-1111-4111-8111-111111111111', t.at(180), t.at(240), 4500),
  ('5b000000-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', null, 'd2222221-2222-4222-8222-222222222222', t.at(240), t.at(290), 5200);

-- 時刻の条件を作るための枠（9時より前になりうるため、制約を一度外して入れ、新しい行だけに効かせて戻す）
alter table public.slots drop constraint slots_business_hours;
insert into public.slots (id, salon_id, menu_id, start_at, end_at, price, status) values
  -- 締切（開始10分前）を過ぎた公開中の枠
  ('5a000000-0000-4000-8000-0000000000ff', '11111111-1111-4111-8111-111111111111', 'd1111111-1111-4111-8111-111111111111', now() + interval '5 min',  now() + interval '65 min', 4500, 'open'),
  -- 終わった予約（無断キャンセルの記録用）
  ('5a000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'd1111111-1111-4111-8111-111111111111', now() - interval '3 hour', now() - interval '2 hour', 4500, 'booked'),
  ('5a000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'd1111111-1111-4111-8111-111111111111', now() - interval '90 min', now() - interval '30 min', 4500, 'booked'),
  -- 締切を過ぎた予約済みの枠（キャンセル後に公開へ戻らないことの確認用）
  ('5b000000-0000-4000-8000-0000000000fe', '22222222-2222-4222-8222-222222222222', 'd2222221-2222-4222-8222-222222222222', now() + interval '5 min',  now() + interval '55 min', 5200, 'booked');
alter table public.slots add constraint slots_business_hours
  check ((start_at at time zone 'Asia/Tokyo')::time >= time '09:00') not valid;

insert into public.bookings (id, slot_id, user_id, contact_name, contact_phone) values
  ('b0000000-0000-4000-8000-0000000000e1', '5a000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000006', '森 六花', '090-0000-0006'),
  ('b0000000-0000-4000-8000-0000000000e2', '5a000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-000000000006', '森 六花', '090-0000-0006'),
  ('b0000000-0000-4000-8000-0000000000fe', '5b000000-0000-4000-8000-0000000000fe', '00000000-0000-4000-8000-000000000007', '林 七海', '090-0000-0007');

-- ---------------------------------------------------------
-- T1〜T21：既存の確認（仕様の変更に合わせて更新）
-- ---------------------------------------------------------
select t.ok('T1 新規登録でプロフィールが作られる', (select count(*) from public.profiles) = 11);
select t.ok('T1 不正な性別は空になる', (select gender from public.profiles where id = '00000000-0000-4000-8000-000000000003') is null);
select t.ok('T1 メールアドレス・年代・エリアが入る',
  (select email = 'user1@demo.test' and age_group = '20s' and area_id = 'e0000001-0000-4000-8000-000000000001'
   from public.profiles where id = '00000000-0000-4000-8000-000000000001'));
select t.ok('T1 18歳以上の確認がない人は空のまま',
  (select adult_confirmed_at is null from public.profiles where id = '00000000-0000-4000-8000-000000000004'));
select t.ok('T1 規約への同意が版つきで記録される',
  (select count(*) = 2 and bool_and(version = '2026-10') from public.consents where user_id = '00000000-0000-4000-8000-000000000001'));

insert into t.ctx values ('open_slots', (select count(*) from public.slots where status = 'open')::text);
begin; set local role anon;
select t.ok('T2 ログインしていない人は公開中の枠だけ見られる',
  (select count(*) from public.slots)::text = (select value from t.ctx where key = 'open_slots'));
select t.raises('T2 ログインしていない人は予約を見られない', 'select count(*) from public.bookings', 'permission denied');
commit;

begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select t.runs('T3 利用者1が予約できる（メモ・会話の好みつき）',
  $$select public.book_slot('5a000000-0000-4000-8000-000000000001', '前髪は短めに', null, null, 'talk')$$);
commit;
select t.ok('T3 予約すると枠が予約済みになる',
  (select status from public.slots where id = '5a000000-0000-4000-8000-000000000001') = 'booked');
select t.ok('T3 予約時点の写し（メール・カルテ・会話の好み）が保存される',
  (select contact_email = 'user1@demo.test' and karte ->> 'hair_type' = '細くやわらかい' and conversation_pref = 'talk'
   from public.bookings where slot_id = '5a000000-0000-4000-8000-000000000001' and status = 'confirmed'));
select t.ok('T3 年代・職業は運営用の別表に入る（予約の行には持たない）',
  (select age_group = '20s' and occupation = '会社員' from public.booking_demographics d
   join public.bookings b on b.id = d.booking_id where b.slot_id = '5a000000-0000-4000-8000-000000000001'));

begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select t.raises('T4 利用者2が同じ枠を予約しようとすると already_booked',
  $$select public.book_slot('5a000000-0000-4000-8000-000000000001')$$, 'already_booked');
commit;

begin; set local role anon;
select t.ok('T5 予約済みの枠は匿名では見えない', (select count(*) from public.slots where id = '5a000000-0000-4000-8000-000000000001') = 0);
commit;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select t.ok('T5 予約済みの枠は他の利用者から見えない', (select count(*) from public.slots where id = '5a000000-0000-4000-8000-000000000001') = 0);
commit;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select t.ok('T5 予約した本人には見える', (select count(*) from public.slots where id = '5a000000-0000-4000-8000-000000000001') = 1);
commit;

begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
select t.ok('T6 サロンAは自店の予約（名前・電話・メール・カルテ）を見られる',
  (select count(*) from public.bookings where contact_phone = '090-0000-0001' and contact_email is not null and karte is not null) = 1);
commit;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000b1';
select t.ok('T6 サロンBからサロンAの予約は見えない',
  (select count(*) from public.bookings b join public.slots s on s.id = b.slot_id
   where s.salon_id = '11111111-1111-4111-8111-111111111111') = 0);
select t.raises('T6 サロンは運営用の属性を見られない', 'select count(*) from public.booking_demographics', 'permission denied');
commit;

begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select t.ok('T7 利用者2から利用者1の予約は見えない',
  (select count(*) from public.bookings where user_id = '00000000-0000-4000-8000-000000000001') = 0);
commit;

begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
select t.raises('T8 画面側から枠を直接作れない',
  $$insert into public.slots (salon_id, menu_id, start_at, end_at, price)
    values ('11111111-1111-4111-8111-111111111111', 'd1111111-1111-4111-8111-111111111111', now() + interval '2 hour', now() + interval '3 hour', 1)$$,
  'permission denied');
select t.raises('T8 画面側からメニューを直接書き換えられない',
  $$update public.menus set price = 1$$, 'permission denied');
select t.raises('T8 画面側から通知を直接積めない',
  $$insert into public.notification_outbox (dedupe_key, kind, channel, payload) values ('x', 'booking_created', 'line', '{}')$$,
  'permission denied');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select t.raises('T8 画面側から予約の状態を直接書き換えられない', $$update public.bookings set status = 'completed'$$, 'permission denied');
select t.raises('T8 画面側からプロフィールを直接書き換えられない', $$update public.profiles set phone = '1'$$, 'permission denied');
select t.raises('T8 画面側からアンケートの回答を直接書けない',
  $$insert into public.survey_answers (booking_id, question_id, answer) values (gen_random_uuid(), 'effort', '簡単')$$, 'permission denied');
commit;

begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000b1';
select t.raises('T9 サロンBはサロンAのメニューで枠を作れない',
  $$select public.create_slot('d1111111-1111-4111-8111-111111111111', t.at(120))$$, 'forbidden');
commit;

begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
select t.runs('T10 サロンAは今日の枠を作れる（美容師つき）',
  $$select public.create_slot('d1111111-1111-4111-8111-111111111111', t.at(150), 'a1111111-1111-4111-8111-111111111111')$$);
commit;
select t.ok('T10 枠の締切はメニューの締切（10分前）になる',
  (select deadline_at = start_at - interval '10 minutes' from public.slots
   where stylist_id = 'a1111111-1111-4111-8111-111111111111' and start_at = t.at(150)));

begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
select t.raises('T11 同じ美容師の時間が重なる枠は作れない',
  $$select public.create_slot('d1111111-1111-4111-8111-111111111111', t.at(170), 'a1111111-1111-4111-8111-111111111111')$$, 'overlap');
select t.raises('T12 明日の枠は作れない',
  $$select public.create_slot('d1111111-1111-4111-8111-111111111111', t.at(0) + interval '1 day')$$, 'today_only');
select t.ok('T12 9時より前の枠は作れない（9時を過ぎていれば締切切れ）',
  t.val($$select public.create_slot('d1111111-1111-4111-8111-111111111111',
          (((now() at time zone 'Asia/Tokyo')::date + time '08:00') at time zone 'Asia/Tokyo'))$$)
  ~ 'outside_hours|too_late');
commit;

begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select t.raises('T13 女性限定のサロンに、男性の利用者は予約できない',
  $$select public.book_slot('5c000000-0000-4000-8000-000000000001')$$, 'not_accepted');
select t.raises('T14 締切を過ぎた枠は予約できない',
  $$select public.book_slot('5a000000-0000-4000-8000-0000000000ff')$$, 'too_late');
commit;

-- T15 無断キャンセルが直近90日で2回になると予約できない
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
select t.runs('T15 予約時刻を過ぎた予約に無断キャンセルを記録できる（1回目）',
  $$select public.salon_update_booking('b0000000-0000-4000-8000-0000000000e1', 'no_show')$$);
commit;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000006';
select t.ok('T15 1回目では予約停止にならない', public.my_suspension() is null);
commit;
-- 1回目を20日前にずらしてから2回目を記録する（再開日の計算を確かめるため）
update public.no_show_records set recorded_at = now() - interval '20 days' where booking_id = 'b0000000-0000-4000-8000-0000000000e1';
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
select t.runs('T15 無断キャンセルを記録できる（2回目）',
  $$select public.salon_update_booking('b0000000-0000-4000-8000-0000000000e2', 'no_show')$$);
commit;
select t.ok('T15 記録は数字だけの電話番号に紐づく',
  (select count(*) from public.no_show_records where phone = '09000000006') = 2);
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000006';
select t.raises('T15 2回目で予約できなくなる', $$select public.book_slot('5b000000-0000-4000-8000-000000000001')$$, 'suspended');
select t.ok('T15 再開日は、古いほうの記録から90日後',
  abs(extract(epoch from public.my_suspension() - (now() - interval '20 days' + interval '90 days'))) < 5);
select t.raises('T15 予約停止中は電話番号を変えられない',
  $$select public.update_my_profile('森 六花', '090-9999-9999', 'female', null, null, null, null, null, null, null)$$, 'suspended');
commit;
delete from auth.users where id = '00000000-0000-4000-8000-000000000006';
select t.ok('T15 アカウントを削除しても、記録は残る',
  (select count(*) from public.no_show_records where phone = '09000000006') = 2
  and public.suspension_until('090-0000-0006') is not null);

begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
select t.raises('T16 開始前の予約に無断キャンセルは記録できない',
  $$select public.salon_update_booking((select id from public.bookings where slot_id = '5a000000-0000-4000-8000-000000000001' and status = 'confirmed'), 'no_show')$$,
  'not_started');
commit;

insert into t.ctx values ('b_u1_sa1',
  (select id from public.bookings where slot_id = '5a000000-0000-4000-8000-000000000001' and status = 'confirmed')::text);
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000b1';
select t.raises('T17 サロンBはサロンAの予約を操作できない',
  $$select public.salon_update_booking((select value::uuid from t.ctx where key = 'b_u1_sa1'), 'cancel_salon')$$,
  'forbidden');
commit;

-- ---------------------------------------------------------
-- T22 1アカウント1件
-- ---------------------------------------------------------
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select t.raises('T22 予約中の利用者は、別の枠を予約できない',
  $$select public.book_slot('5b000000-0000-4000-8000-000000000001')$$, 'has_active_booking');
commit;

-- T18 サロン都合のキャンセル
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
select t.runs('T18 サロン都合でキャンセルできる',
  $$select public.salon_update_booking((select id from public.bookings where slot_id = '5a000000-0000-4000-8000-000000000001' and status = 'confirmed'), 'cancel_salon')$$);
commit;
select t.ok('T18 締切まで時間があれば、枠が公開に戻る',
  (select status from public.slots where id = '5a000000-0000-4000-8000-000000000001') = 'open');
select t.ok('T18 無断キャンセルとしては記録しない',
  (select count(*) from public.no_show_records where phone = '09000000001') = 0);
select t.ok('T18 利用者へのメールが送信待ちに積まれる',
  (select count(*) from public.notification_outbox where kind = 'salon_cancel_mail' and recipient = 'user1@demo.test') = 1);
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select t.runs('T18 戻った枠を別の利用者が予約できる', $$select public.book_slot('5a000000-0000-4000-8000-000000000001')$$);
commit;
select t.ok('T18 有効な予約は1件、履歴は2件',
  (select count(*) filter (where status = 'confirmed') = 1 and count(*) = 2
   from public.bookings where slot_id = '5a000000-0000-4000-8000-000000000001'));

-- ---------------------------------------------------------
-- T23 キャンセル理由ごとの扱い
-- ---------------------------------------------------------
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select t.runs('T23 キャンセル後は、利用者1が別の枠を予約できる', $$select public.book_slot('5b000000-0000-4000-8000-000000000001')$$);
commit;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000b1';
select t.runs('T23 お客様から連絡があったキャンセルを記録できる',
  $$select public.salon_update_booking((select id from public.bookings where slot_id = '5b000000-0000-4000-8000-000000000001' and status = 'confirmed'), 'cancel_customer')$$);
select t.runs('T23 締切を過ぎた予約もキャンセルできる',
  $$select public.salon_update_booking('b0000000-0000-4000-8000-0000000000fe', 'cancel_salon')$$);
commit;
select t.ok('T23 お客様連絡のキャンセルは cancelled_by_customer になる',
  (select count(*) from public.bookings where slot_id = '5b000000-0000-4000-8000-000000000001' and status = 'cancelled_by_customer') = 1);
select t.ok('T23 お客様連絡のキャンセルも無断キャンセルとしては記録しない',
  (select count(*) from public.no_show_records where phone = '09000000001') = 0);
select t.ok('T23 お客様連絡のキャンセルでは利用者へメールを送らない',
  (select count(*) from public.notification_outbox o join public.bookings b on b.id = o.booking_id
   where b.status = 'cancelled_by_customer' and o.channel = 'email') = 0);
select t.ok('T23 キャンセルはサロンの LINE に積まれる',
  (select count(*) from public.notification_outbox where kind = 'booking_cancelled') = 3);
select t.ok('T23 締切まで時間があれば公開に戻り、過ぎていれば戻らない',
  (select status from public.slots where id = '5b000000-0000-4000-8000-000000000001') = 'open'
  and (select status from public.slots where id = '5b000000-0000-4000-8000-0000000000fe') = 'closed');

-- ---------------------------------------------------------
-- T24 メニューごとの受付締切
-- ---------------------------------------------------------
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000b1';
select t.raises('T24 3時間前締切のメニューは、2時間後の枠を出せない',
  $$select public.create_slot('d2222222-2222-4222-8222-222222222222', now() + interval '120 min')$$, 'too_late');
select t.runs('T24 3時間前締切のメニューでも、締切前なら枠を出せる',
  $$select public.create_slot('d2222222-2222-4222-8222-222222222222', t.at(300))$$);
commit;
select t.ok('T24 締切は開始の3時間前になる',
  (select deadline_at = start_at - interval '180 minutes' from public.slots
   where menu_id = 'd2222222-2222-4222-8222-222222222222' and start_at = t.at(300)));

-- ---------------------------------------------------------
-- T25 利用者向けの検索（締切・性別・エリア）
-- ---------------------------------------------------------
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select t.ok('T25 締切を過ぎた枠は検索に出ない',
  not exists (select 1 from public.search_open_slots(public.jst_today_end()) where slot_id = '5a000000-0000-4000-8000-0000000000ff'));
select t.ok('T25 男性の利用者には、女性限定のサロンの枠が出ない',
  not exists (select 1 from public.search_open_slots(public.jst_today_end()) where salon_id = '33333333-3333-4333-8333-333333333333'));
commit;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select t.ok('T25 女性の利用者には、女性限定のサロンの枠も出る',
  exists (select 1 from public.search_open_slots(public.jst_today_end()) where salon_id = '33333333-3333-4333-8333-333333333333'));
select t.ok('T25 別のエリアを選ぶと、そのエリアの枠だけになる',
  (select count(*) from public.search_open_slots(public.jst_today_end(), 'e0000002-0000-4000-8000-000000000002')) = 0);
select t.ok('T25 時間帯の終わりより後の枠は出ない',
  not exists (select 1 from public.search_open_slots(t.at(100)) where start_at >= t.at(100)));
commit;

-- ---------------------------------------------------------
-- T26 時間切れの枠の自動処理
-- ---------------------------------------------------------
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
select t.raises('T26 画面側からは時間切れの処理を呼べない', 'select public.expire_stale_slots()', 'permission denied');
commit;
select t.ok('T26 時間切れの処理が締切を過ぎた枠を数える', public.expire_stale_slots() >= 1);
select t.ok('T26 締切を過ぎた公開中の枠が、受付終了になる',
  (select status from public.slots where id = '5a000000-0000-4000-8000-0000000000ff') = 'expired');
select t.ok('T26 締切前の枠はそのまま', (select status from public.slots where id = '5a000000-0000-4000-8000-000000000002') = 'open');
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select t.ok('T26 受付終了の枠は予約できない（締切切れとして扱う）',
  t.val($$select public.book_slot('5a000000-0000-4000-8000-0000000000ff')$$) ~ 'too_late|has_active_booking');
commit;

-- ---------------------------------------------------------
-- T27 通知の積み込みと二重送信の防止
-- ---------------------------------------------------------
select t.ok('T27 予約の成立がサロンの LINE に積まれる（予約1件につき1件）',
  (select count(*) from public.notification_outbox where kind = 'booking_created')
  = (select count(*) from public.bookings where not demo_history));
select t.ok('T27 LINE の中身に電話番号とメールアドレスを載せない',
  not exists (select 1 from public.notification_outbox
              where channel = 'line' and (payload::text like '%090-%' or payload::text like '%@demo.test%')));
select t.ok('T27 メールの中身にカルテ・写真・位置情報を載せない',
  not exists (select 1 from public.notification_outbox
              where channel = 'email' and (payload ? 'karte' or payload ? 'photo_path' or payload ? 'lat')));
update public.bookings set status = status where slot_id = '5a000000-0000-4000-8000-000000000001';
select t.ok('T27 状態が変わらない更新では通知を積まない',
  (select count(*) from public.notification_outbox where kind = 'booking_created')
  = (select count(*) from public.bookings where not demo_history));

begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
select t.raises('T27 画面側からは送信待ちを取り出せない', 'select public.claim_notifications(10)', 'permission denied');
select t.ok('T27 サロンAは自店宛ての LINE 通知だけ見える',
  (select count(*) from public.notification_outbox where channel = 'email') = 0
  and (select count(*) from public.notification_outbox) > 0
  and (select bool_and(salon_id = '11111111-1111-4111-8111-111111111111') from public.notification_outbox));
commit;

begin; set local role service_role;
create temp table claimed1 as select id from public.claim_notifications(2);
create temp table claimed2 as select id from public.claim_notifications(50);
select t.ok('T27 1回目の取り出しは指定した件数まで', (select count(*) from claimed1) = 2);
select t.ok('T27 同じ通知は二度取り出されない', not exists (select 1 from claimed1 join claimed2 using (id)));
select t.ok('T27 送信結果を記録できる',
  public.finish_notification((select min(id) from claimed1), 'simulated', null, '{"preview":true}'));
select t.ok('T27 送信済みの通知に、もう一度結果を書かない',
  not public.finish_notification((select min(id) from claimed1), 'sent'));
select t.ok('T27 送信済みの通知は取り出されない', (select count(*) from public.claim_notifications(50)) = 0);
commit;
select t.ok('T27 送信日時が記録される',
  (select sent_at is not null and status = 'simulated' from public.notification_outbox
   where id = (select min(id) from public.notification_outbox where status = 'simulated')));
update public.notification_outbox set status = 'pending', locked_at = null where status = 'sending';

-- ---------------------------------------------------------
-- T28 アンケート
-- ---------------------------------------------------------
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select t.ok('T28 予約した本人はアンケートに答えられる',
  public.submit_survey((select id from public.bookings where slot_id = '5a000000-0000-4000-8000-000000000001' and status = 'confirmed'),
                       '{"would_have_gone":"たぶん行かなかった","effort":"とても簡単"}') = 2);
select t.raises('T28 選択肢にない回答は受け付けない',
  $$select public.submit_survey((select id from public.bookings where slot_id = '5a000000-0000-4000-8000-000000000001' and status = 'confirmed'), '{"effort":"x"}')$$,
  'invalid_input');
select t.raises('T28 本人も回答を直接は読めない', 'select count(*) from public.survey_answers', 'permission denied');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select t.raises('T28 他人の予約のアンケートには答えられない',
  $$select public.submit_survey((select id from public.bookings where slot_id = '5a000000-0000-4000-8000-000000000001' and status = 'confirmed' limit 1), '{"effort":"簡単"}')$$,
  'forbidden');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
select t.raises('T28 サロンはアンケートの回答を見られない', 'select count(*) from public.survey_answers', 'permission denied');
commit;

-- ---------------------------------------------------------
-- T29 ヘア写真
-- ---------------------------------------------------------
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000005';
select t.runs('T29 自分のフォルダに写真を置ける',
  $$insert into storage.objects (bucket_id, name) values ('hair-photos', '00000000-0000-4000-8000-000000000005/p1.jpg')$$);
select t.raises('T29 他人のフォルダには置けない',
  $$insert into storage.objects (bucket_id, name) values ('hair-photos', '00000000-0000-4000-8000-000000000001/x.jpg')$$,
  'row-level security');
select t.raises('T29 他人の写真を予約に添えられない',
  $$select public.book_slot('5b000000-0000-4000-8000-000000000003', null, '00000000-0000-4000-8000-000000000001/x.jpg')$$,
  'invalid_photo');
select t.runs('T29 予約に写真1枚とメモを添えられる',
  $$select public.book_slot('5b000000-0000-4000-8000-000000000003', null, '00000000-0000-4000-8000-000000000005/p1.jpg', '横は耳が出るくらい')$$);
commit;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000b1';
select t.ok('T29 写真を共有した予約のサロンは見られる', (select count(*) from storage.objects) = 1);
commit;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
select t.ok('T29 ほかのサロンからは見えない', (select count(*) from storage.objects) = 0);
commit;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select t.ok('T29 ほかの利用者からは見えない', (select count(*) from storage.objects) = 0);
commit;
begin; set local role anon;
select t.raises('T29 ログインしていない人は見られない', 'select count(*) from storage.objects', 'permission denied');
commit;

-- ---------------------------------------------------------
-- T30 18歳以上・電話番号
-- ---------------------------------------------------------
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';
select t.raises('T30 18歳以上の確認がないと予約できない',
  $$select public.book_slot('5c000000-0000-4000-8000-000000000001')$$, 'adult_required');
select t.raises('T30 18歳以上でないと確認できない', $$select public.confirm_terms('2026-10', false)$$, 'adult_required');
select t.runs('T30 18歳以上の確認と規約への同意を記録できる', $$select public.confirm_terms('2026-10', true)$$);
commit;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
select t.runs('T30 プロフィールを関数経由で更新できる',
  $$select public.update_my_profile('田中 三郎', '', null, '50s', 'その他', null, 'either', null, null, null)$$);
select t.raises('T30 電話番号がないと予約できない',
  $$select public.book_slot('5a000000-0000-4000-8000-000000000002')$$, 'phone_required');
commit;

-- ---------------------------------------------------------
-- T31 サロンの設定
-- ---------------------------------------------------------
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
select t.runs('T31 サロンは受け付ける性別・電話・LINE のグループを設定できる',
  $$select public.salon_update_settings('11111111-1111-4111-8111-111111111111', array['female','male'], '000-0000-0001', 'Cdemo-group-a')$$);
select t.runs('T31 サロンはメニュー（締切つき）を追加できる',
  $$select public.salon_upsert_menu('11111111-1111-4111-8111-111111111111', null, 'カラー（リタッチ）', 90, 6600, 120)$$);
select t.raises('T31 締切の分数が範囲外なら受け付けない',
  $$select public.salon_upsert_menu('11111111-1111-4111-8111-111111111111', null, 'x', 60, 1000, 700)$$, 'invalid_input');
select t.runs('T31 いつもの枠を保存できる',
  $$select public.salon_save_preset('11111111-1111-4111-8111-111111111111', 'カット 45分後', 'd1111111-1111-4111-8111-111111111111', null, array[45])$$);
select t.ok('T31 自店の LINE グループは見える',
  (select line_group_id from public.salon_private where salon_id = '11111111-1111-4111-8111-111111111111') = 'Cdemo-group-a');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000b1';
select t.raises('T31 サロンBはサロンAの設定を変えられない',
  $$select public.salon_update_settings('11111111-1111-4111-8111-111111111111', array['female'], null, null)$$, 'forbidden');
select t.raises('T31 サロンBはサロンAのいつもの枠を消せない',
  $$select public.salon_delete_preset('f0000001-0000-4000-8000-000000000001')$$, 'forbidden');
select t.ok('T31 ほかのサロンの LINE グループは見えない',
  (select count(*) from public.salon_private where salon_id = '11111111-1111-4111-8111-111111111111') = 0);
commit;
begin; set local role anon;
select t.raises('T31 ログインしていない人は LINE グループを見られない', 'select count(*) from public.salon_private', 'permission denied');
commit;

-- ---------------------------------------------------------
-- T32 掲載希望と運営の権限
-- ---------------------------------------------------------
begin; set local role anon;
select t.runs('T32 ログインしていなくても掲載希望を送れる',
  $$select public.submit_salon_application('Hair Studio Demo', '山本', 'owner@example.test', null, '駅前エリア', '始め方を知りたい')$$);
select t.raises('T32 メールアドレスが不正なら受け付けない',
  $$select public.submit_salon_application('x', 'y', 'not-mail', null, 'z', null)$$, 'invalid_input');
select t.raises('T32 ログインしていない人は掲載希望を見られない', 'select count(*) from public.salon_applications', 'permission denied');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
select t.ok('T32 サロンは掲載希望を見られない', (select count(*) from public.salon_applications) = 0);
select t.raises('T32 サロンは掲載希望を承認できない',
  $$select public.admin_approve_application((select id from public.salon_applications limit 1), null)$$, 'forbidden');
select t.raises('T32 サロンは実証の数字を見られない', $$select public.admin_metrics(current_date - 7, current_date)$$, 'forbidden');
select t.raises('T32 サロンは予約停止中の電話番号を見られない', $$select * from public.admin_suspended_phones()$$, 'forbidden');
select t.raises('T32 サロンは終了処理の試し実行を呼べない', $$select public.admin_trial_end_dry_run()$$, 'forbidden');
select t.raises('T32 サロンは無断キャンセルの記録を見られない', 'select count(*) from public.no_show_records', 'permission denied');
select t.ok('T32 サロンは操作記録を見られない', (select count(*) from public.audit_logs) = 0);
select t.ok('T32 サロンから利用者のプロフィールは見えない', (select count(*) from public.profiles) = 1);
commit;
insert into t.ctx values ('bookings_total', (select count(*) from public.bookings)::text);
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000ad';
select t.ok('T32 運営は掲載希望を見られる', (select count(*) from public.salon_applications) = 1);
select t.runs('T32 運営は掲載希望を承認できる（サロンとスタッフの紐づけを作る）',
  $$select public.admin_approve_application((select id from public.salon_applications limit 1), '00000000-0000-4000-8000-0000000000c9')$$);
select t.raises('T32 承認済みの申込は二重に承認できない',
  $$select public.admin_approve_application((select id from public.salon_applications limit 1), null)$$, 'already_closed');
select t.ok('T32 運営は全サロンの予約を見られる',
  (select count(*) from public.bookings)::text = (select value from t.ctx where key = 'bookings_total'));
select t.ok('T32 運営は操作記録を見られる', (select count(*) from public.audit_logs) > 0);
select t.ok('T32 予約停止中の電話番号は一部を伏せて表示される',
  (select masked_phone from public.admin_suspended_phones() limit 1) = '090****0006');
commit;
select t.ok('T32 承認すると、サロンとスタッフが紐づく',
  exists (select 1 from public.salon_members m join public.salons s on s.id = m.salon_id
          where m.user_id = '00000000-0000-4000-8000-0000000000c9' and s.name = 'Hair Studio Demo' and s.is_approved));

-- ---------------------------------------------------------
-- T33 実証の数字・終了処理の試し実行
-- ---------------------------------------------------------
create temp table before_counts as select (select count(*) from public.bookings) as b, (select count(*) from public.profiles) as p;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000ad';
create temp table m as
  select public.admin_metrics((now() at time zone 'Asia/Tokyo')::date, (now() at time zone 'Asia/Tokyo')::date, 1) as j;
select t.ok('T33 公開された枠の数が、今日の枠の数と一致する',
  (select (j ->> 'published_slots')::int from m)
  = (select count(*) from public.slots where (start_at at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date),
  (select j::text from m));
select t.ok('T33 成約率・来店率・時間帯別・サロン別・アンケートが出る',
  (select j ? 'conversion_rate' and j ? 'visit_rate' and jsonb_array_length(j -> 'by_hour') > 0
      and jsonb_array_length(j -> 'by_salon') >= 3 and jsonb_array_length(j -> 'survey') = 2 from m));
select t.ok('T33 アンケートの回答が集計に入る',
  (select (j -> 'survey' -> 0 ->> 'responses')::int >= 1 from m));
select t.ok('T33 継続して枠を出しているサロンの割合が出る（日数は引数）',
  (select (j -> 'continuing' ->> 'min_days')::int = 1 and (j -> 'continuing' ->> 'salons')::int >= 2 from m));
select t.ok('T33 終了処理の試し実行は対象件数を返す',
  (select jsonb_array_length(public.admin_trial_end_dry_run() -> 'items')) >= 8);
commit;
select t.ok('T33 試し実行では何も消さない',
  (select b from before_counts) = (select count(*) from public.bookings)
  and (select p from before_counts) = (select count(*) from public.profiles));

-- ---------------------------------------------------------
-- T35 予約番号（0005）
-- ---------------------------------------------------------
select t.ok('T35 関数で作った予約には予約番号が付く',
  not exists (select 1 from public.bookings where booking_no is null and not demo_history
              and id not in ('b0000000-0000-4000-8000-0000000000e1', 'b0000000-0000-4000-8000-0000000000e2', 'b0000000-0000-4000-8000-0000000000fe')));
select t.ok('T35 予約番号は、その日そのサロンで重ならない',
  not exists (select 1 from public.bookings b join public.slots s on s.id = b.slot_id
              where b.booking_no is not null
              group by s.salon_id, (s.start_at at time zone 'Asia/Tokyo')::date, b.booking_no having count(*) > 1));
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
select t.ok('T35 サロンは自店の予約の予約番号を見られる',
  (select booking_no from public.bookings where slot_id = '5a000000-0000-4000-8000-000000000001' and status = 'confirmed') is not null);
select t.raises('T35 番号の払い出し表は画面側から見えない', 'select count(*) from public.booking_counters', 'permission denied');
select t.raises('T35 番号の払い出しは画面側から呼べない', $$select public.next_booking_no('11111111-1111-4111-8111-111111111111', now())$$, 'permission denied');
commit;

-- ---------------------------------------------------------
-- T36 「今日はここまで」と「元に戻す」（0005）
-- ---------------------------------------------------------
insert into t.ctx values ('a_open', (select count(*) from public.slots where salon_id = '11111111-1111-4111-8111-111111111111'
  and status = 'open' and start_at >= public.jst_today_start() and start_at < public.jst_today_end())::text);
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000b1';
select t.raises('T36 ほかのサロンの枠はまとめて取り下げられない', $$select public.salon_pause_today('11111111-1111-4111-8111-111111111111')$$, 'forbidden');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
select t.ok('T36 今日の公開中の枠を、まとめて取り下げられる',
  public.salon_pause_today('11111111-1111-4111-8111-111111111111')::text = (select value from t.ctx where key = 'a_open'));
commit;
select t.ok('T36 取り下げた枠は「今日はここまで」として残る',
  (select status = 'closed' and closed_reason = 'paused' from public.slots where id = '5a000000-0000-4000-8000-000000000002'));
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select t.ok('T36 取り下げた枠は利用者の検索に出ない',
  not exists (select 1 from public.search_open_slots(public.jst_today_end()) where salon_id = '11111111-1111-4111-8111-111111111111'));
commit;
-- 取り下げのあとに、同じ担当の重なる枠を出しておく（元に戻すときに、その枠は戻さない）
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
select t.runs('T36 取り下げ中は、同じ時間に別の枠を出せる',
  $$select public.create_slot('d1111111-1111-4111-8111-111111111111', t.at(170), 'a1111111-1111-4111-8111-111111111111')$$);
create temp table resumed as select public.salon_resume_today('11111111-1111-4111-8111-111111111111') as r;
select t.ok('T36 元に戻すと、締切前の枠だけが再び公開される',
  (select (r ->> 'reopened')::int >= 1 and (r ->> 'skipped')::int >= 1 from resumed), (select r::text from resumed));
commit;
select t.ok('T36 戻した枠は公開中になる', (select status from public.slots where id = '5a000000-0000-4000-8000-000000000002') = 'open');
select t.ok('T36 重なる枠があるものは取り下げのまま',
  (select status = 'closed' and closed_reason = 'paused' from public.slots
   where stylist_id = 'a1111111-1111-4111-8111-111111111111' and start_at = t.at(150)));
select t.ok('T36 まとめての取り下げと再公開が記録に残る',
  (select count(distinct action) from public.audit_logs where action in ('pause_today', 'resume_today')) = 2);

-- ---------------------------------------------------------
-- T37 空いた時間を切り分けた枠を、まとめて作る（0005）
-- ---------------------------------------------------------
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
create temp table bulk as select public.create_slots('d1111111-1111-4111-8111-111111111111',
  array[t.at(200), now() + interval '1 minute', t.at(0) + interval '1 day']) as r;
select t.ok('T37 作れる枠だけを作る', (select jsonb_array_length(r -> 'created') = 1 from bulk), (select r::text from bulk));
select t.ok('T37 作れなかった枠は理由を返す',
  (select jsonb_agg(f ->> 'reason' order by f ->> 'reason') = '["today_only", "too_late"]'::jsonb
   from bulk, jsonb_array_elements(r -> 'failed') f));
commit;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000b1';
select t.raises('T37 ほかのサロンのメニューでは、まとめて作れない',
  $$select public.create_slots('d1111111-1111-4111-8111-111111111111', array[t.at(210)])$$, 'forbidden');
commit;

-- ---------------------------------------------------------
-- T38 いつもの空き方・初期設定（0005）
-- ---------------------------------------------------------
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
select t.runs('T38 いつもの空き方を保存できる',
  $$select public.salon_save_free_preset('11111111-1111-4111-8111-111111111111', '空き90分・カット', 'd1111111-1111-4111-8111-111111111111', null, 90)$$);
select t.raises('T38 空き時間の長さが範囲外なら受け付けない',
  $$select public.salon_save_free_preset('11111111-1111-4111-8111-111111111111', 'x', 'd1111111-1111-4111-8111-111111111111', null, 300)$$, 'invalid_input');
select t.runs('T38 初期設定の進み具合を残せる', $$select public.salon_set_onboarding('11111111-1111-4111-8111-111111111111', 2)$$);
select t.ok('T38 進み具合は自店だけ読める',
  (select onboarding_step from public.salon_private where salon_id = '11111111-1111-4111-8111-111111111111') = 2);
select public.salon_set_onboarding('11111111-1111-4111-8111-111111111111', 3);
commit;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000b1';
select t.raises('T38 ほかのサロンのいつもの空き方は保存できない',
  $$select public.salon_save_free_preset('11111111-1111-4111-8111-111111111111', 'x', 'd1111111-1111-4111-8111-111111111111', null, 60)$$, 'forbidden');
select t.raises('T38 ほかのサロンの初期設定は変えられない', $$select public.salon_set_onboarding('11111111-1111-4111-8111-111111111111', 0)$$, 'forbidden');
select t.ok('T38 メニューのある既存のサロンは、設定済みとして扱う',
  (select onboarding_step from public.salon_private where salon_id = '22222222-2222-4222-8222-222222222222') = 3);
commit;

-- ---------------------------------------------------------
-- T39 検索結果の担当の名前（0006）
-- ---------------------------------------------------------
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select t.ok('T39 担当を指定した枠は、検索結果に担当の名前が出る',
  exists (select 1 from public.search_open_slots(public.jst_today_end()) where stylist_name = '佐藤'));
select t.ok('T39 担当を指定しない枠は、担当の名前が空',
  exists (select 1 from public.search_open_slots(public.jst_today_end()) where stylist_name is null));
commit;

-- ---------------------------------------------------------
-- T40 サロンの住所・位置（0006）
-- ---------------------------------------------------------
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
select t.runs('T40 サロンは自店の住所・位置・エリアを設定できる',
  $$select public.salon_update_profile('11111111-1111-4111-8111-111111111111', 'HAIR ROOM AOI', '駅の東口から徒歩5分（デモ）',
    'e0000001-0000-4000-8000-000000000001', 34.6655, 133.9235)$$);
select t.raises('T40 日本の範囲外の位置は受け付けない',
  $$select public.salon_update_profile('11111111-1111-4111-8111-111111111111', 'HAIR ROOM AOI', 'x', null, 0, 0)$$, 'invalid_input');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000b1';
select t.raises('T40 ほかのサロンの住所・位置は変えられない',
  $$select public.salon_update_profile('11111111-1111-4111-8111-111111111111', 'x', 'y', null, 34.6, 133.9)$$, 'forbidden');
commit;

-- ---------------------------------------------------------
-- T41 運営による掲載の停止・再開（0006）
-- ---------------------------------------------------------
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
select t.raises('T41 サロンは掲載を止められない',
  $$select public.admin_set_salon_approved('22222222-2222-4222-8222-222222222222', false)$$, 'forbidden');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000ad';
select t.runs('T41 運営はサロンの掲載を止められる', $$select public.admin_set_salon_approved('22222222-2222-4222-8222-222222222222', false)$$);
commit;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select t.ok('T41 掲載を止めたサロンの枠は検索に出ない',
  not exists (select 1 from public.search_open_slots(public.jst_today_end()) where salon_id = '22222222-2222-4222-8222-222222222222'));
select t.raises('T41 掲載を止めたサロンの枠は予約できない',
  $$select public.book_slot('5b000000-0000-4000-8000-000000000001')$$, 'slot_not_found');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000ad';
select t.runs('T41 運営は掲載を再開できる', $$select public.admin_set_salon_approved('22222222-2222-4222-8222-222222222222', true)$$);
commit;
select t.ok('T41 掲載の停止と再開が記録に残る',
  (select count(distinct action) from public.audit_logs where action in ('suspend_salon', 'resume_salon')) = 2);

-- ---------------------------------------------------------
-- T34 デモ用の関数（サーバー側だけ）
-- ---------------------------------------------------------
begin; set local role authenticated; set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000ad';
select t.raises('T34 画面側からはデモのリセットを呼べない（運営でも）', 'select public.demo_reset(false)', 'permission denied');
commit;
begin; set local role service_role;
select t.ok('T34 サーバー側からデモをリセットし、過去7日分の架空データを作れる',
  (select (r ->> 'history_slots')::int > 0 from (select public.demo_reset(true) as r) x));
select t.runs('T34 同時予約チャレンジ用の枠を作れる', 'select public.demo_prepare_challenge()');
commit;
select t.ok('T34 架空データでは通知を積まない',
  not exists (select 1 from public.notification_outbox o join public.bookings b on b.id = o.booking_id where b.demo_history));

-- ---------------------------------------------------------
-- T21 操作記録
-- ---------------------------------------------------------
select t.ok('T21 サロン・運営の操作が記録に残る',
  (select count(distinct action) from public.audit_logs
   where action in ('create_slot', 'booking_no_show', 'booking_cancel_salon', 'booking_cancel_customer',
                    'update_salon_settings', 'upsert_menu', 'approve_application', 'trial_end_dry_run')) = 8);

-- 結果の一覧は run.sh が出す
