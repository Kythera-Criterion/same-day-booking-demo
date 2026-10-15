-- 0002 以降で使うデモ用データ（店名・住所・電話番号はすべて架空です）
-- 何度流しても同じ状態になります

insert into public.areas (id, name, lat, lng, sort_order) values
  ('e0000001-0000-4000-8000-000000000001', '駅前エリア（デモ）', 34.6664, 133.9178, 1),
  ('e0000002-0000-4000-8000-000000000002', '大学通りエリア（デモ）', 34.6880, 133.9220, 2)
on conflict (id) do update set name = excluded.name, lat = excluded.lat, lng = excluded.lng,
                               sort_order = excluded.sort_order;

update public.salons set area_id = 'e0000001-0000-4000-8000-000000000001'
where id in ('11111111-1111-4111-8111-111111111111',
             '22222222-2222-4222-8222-222222222222',
             '33333333-3333-4333-8333-333333333333')
  and area_id is null;

update public.salons set phone = v.phone
from (values
  ('11111111-1111-4111-8111-111111111111'::uuid, '000-0000-0001'),
  ('22222222-2222-4222-8222-222222222222'::uuid, '000-0000-0002'),
  ('33333333-3333-4333-8333-333333333333'::uuid, '000-0000-0003')
) as v(id, phone)
where salons.id = v.id and salons.phone is null;

insert into public.salon_private (salon_id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333')
on conflict (salon_id) do nothing;

-- 開始3時間前に締め切るメニュー（カラー）
insert into public.menus (id, salon_id, name, duration_min, price, booking_deadline_min) values
  ('d2222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'カット＋カラー', 120, 9800, 180)
on conflict (id) do update set name = excluded.name, duration_min = excluded.duration_min,
                               price = excluded.price, booking_deadline_min = excluded.booking_deadline_min;

-- 予約直後のアンケート（仮置き。この表を書き換えれば差し替えられる）
insert into public.survey_questions (id, body, choices, sort_order) values
  ('would_have_gone', 'このサービスがなければ、今日髪を切りに行っていましたか',
   array['行っていた', 'たぶん行っていた', 'たぶん行かなかった', '行かなかった'], 1),
  ('effort', '予約までの手間はどうでしたか',
   array['とても簡単', '簡単', 'ふつう', '手間がかかった'], 2)
on conflict (id) do update set body = excluded.body, choices = excluded.choices, sort_order = excluded.sort_order;

-- いつもの枠（サロンA）
insert into public.slot_presets (id, salon_id, label, menu_id, stylist_id, offsets_min) values
  ('f0000001-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'カット 30分後・60分後',
   'd1111111-1111-4111-8111-111111111111', null, array[30, 60]),
  ('f0000002-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '前髪カット 15分後',
   'd1111112-1111-4111-8111-111111111111', null, array[15])
on conflict (id) do nothing;
