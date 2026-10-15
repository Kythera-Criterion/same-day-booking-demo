-- 録画の直前に実行して、「今」から見た今日の空き枠を用意します。
-- 日本時間の9時〜21時ごろに実行してください（今日の枠しか作れないため）。
-- 何度実行しても構いません。前回の未予約の枠は取り下げてから作り直します。
-- （録画を簡単にするため、ここでは美容師を指定せずに枠を作ります）

update public.slots set status = 'closed'
where status = 'open';

insert into public.slots (salon_id, menu_id, start_at, end_at, price)
select v.salon_id, m.id, v.start_at, v.start_at + make_interval(mins => m.duration_min), m.price
from (
  values
    ('11111111-1111-4111-8111-111111111111'::uuid, 'd1111111-1111-4111-8111-111111111111'::uuid, date_bin('5 minutes', now() + interval '25 minutes',  timestamptz '2000-01-01')),
    ('22222222-2222-4222-8222-222222222222'::uuid, 'd2222221-2222-4222-8222-222222222222'::uuid, date_bin('5 minutes', now() + interval '50 minutes',  timestamptz '2000-01-01')),
    ('33333333-3333-4333-8333-333333333333'::uuid, 'd3333331-3333-4333-8333-333333333333'::uuid, date_bin('5 minutes', now() + interval '70 minutes',  timestamptz '2000-01-01')),
    ('11111111-1111-4111-8111-111111111111'::uuid, 'd1111111-1111-4111-8111-111111111111'::uuid, date_bin('5 minutes', now() + interval '150 minutes', timestamptz '2000-01-01')),
    ('22222222-2222-4222-8222-222222222222'::uuid, 'd2222221-2222-4222-8222-222222222222'::uuid, date_bin('5 minutes', now() + interval '240 minutes', timestamptz '2000-01-01'))
) as v(salon_id, menu_id, start_at)
join public.menus m on m.id = v.menu_id
where v.start_at < public.jst_today_end()
  and (v.start_at at time zone 'Asia/Tokyo')::time >= time '09:00';

select s.start_at at time zone 'Asia/Tokyo' as 開始, sa.name as サロン, s.price as 金額
from public.slots s join public.salons sa on sa.id = s.salon_id
where s.status = 'open'
order by s.start_at;
