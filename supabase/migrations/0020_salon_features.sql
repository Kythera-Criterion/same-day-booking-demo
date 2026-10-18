-- 0020：サロンの画面のデザイン案に合わせた機能のうち、データベースが要るもの
--   1. 担当の写真：stylists.photo（端末で小さく縮めた画像のデータの URL）と、写真を決める関数
--   2. キャンセル待ち：お客様が「このお店に今日空きが出たら知らせてほしい」と登録する。
--      そのお店で今日の枠が公開されたとき（新しく出した・キャンセルで公開に戻った）に、メールの知らせを1回だけ積む。
--      サロンは自分のお店の件数を読める（画面の「キャンセル待ち」）
-- 2回流しても壊れない

-- ---------- 1. 担当の写真 ----------
alter table public.stylists add column if not exists photo text;
alter table public.stylists drop constraint if exists stylists_photo_check;
alter table public.stylists add constraint stylists_photo_check
  check (photo is null or (photo like 'data:image/%' and length(photo) <= 120000));

create or replace function public.salon_set_stylist_photo(p_salon_id uuid, p_id uuid, p_photo text)
returns public.stylists
language plpgsql security definer set search_path = public
as $$
declare
  st public.stylists;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_salon_member(p_salon_id) then raise exception 'forbidden'; end if;
  if p_photo is not null and (p_photo not like 'data:image/%' or length(p_photo) > 120000) then
    raise exception 'invalid_input';
  end if;
  update public.stylists set photo = p_photo
  where id = p_id and salon_id = p_salon_id
  returning * into st;
  if not found then raise exception 'stylist_not_found'; end if;
  return st;
end;
$$;
revoke execute on function public.salon_set_stylist_photo(uuid, uuid, text) from public, anon;
grant execute on function public.salon_set_stylist_photo(uuid, uuid, text) to authenticated;

-- ---------- 2. キャンセル待ち ----------
create table if not exists public.cancel_waits (
  id          uuid primary key default gen_random_uuid(),
  salon_id    uuid not null references public.salons(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  day         date not null default (now() at time zone 'Asia/Tokyo')::date,
  created_at  timestamptz not null default now(),
  notified_at timestamptz,
  unique (salon_id, user_id, day)
);
create index if not exists cancel_waits_salon_day_idx on public.cancel_waits (salon_id, day);

alter table public.cancel_waits enable row level security;
-- 読めるのは、本人・そのお店のスタッフ・運営だけ。登録と解除は下の関数から
drop policy if exists cancel_waits_select on public.cancel_waits;
create policy cancel_waits_select on public.cancel_waits
  for select using (user_id = auth.uid() or public.is_salon_member(salon_id) or public.is_admin());

-- 登録する（同じお店・同じ日は1件。知らせたあとにもう一度押すと、また待つ）
create or replace function public.join_cancel_wait(p_salon_id uuid)
returns public.cancel_waits
language plpgsql security definer set search_path = public
as $$
declare
  w public.cancel_waits;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.salon_is_listed(p_salon_id) then raise exception 'salon_not_listed'; end if;
  insert into public.cancel_waits (salon_id, user_id)
  values (p_salon_id, auth.uid())
  on conflict (salon_id, user_id, day) do update set notified_at = null, created_at = now()
  returning * into w;
  return w;
end;
$$;

-- 解除する（今日の分）
create or replace function public.leave_cancel_wait(p_salon_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  delete from public.cancel_waits
  where salon_id = p_salon_id and user_id = auth.uid() and day = (now() at time zone 'Asia/Tokyo')::date;
end;
$$;
revoke execute on function public.join_cancel_wait(uuid) from public, anon;
revoke execute on function public.leave_cancel_wait(uuid) from public, anon;
grant execute on function public.join_cancel_wait(uuid) to authenticated;
grant execute on function public.leave_cancel_wait(uuid) to authenticated;

-- 知らせの種類に「キャンセル待ちのお知らせ」を足す
alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check
  check (kind in ('booking_created', 'booking_cancelled', 'salon_cancel_mail', 'salon_welcome_mail',
                  'salon_approved_mail', 'salon_rejected_mail', 'admin_invite_mail',
                  'signup_confirm_mail', 'account_exists_mail', 'password_reset_mail', 'cancel_wait_mail'));

-- 今日の枠が公開されたら（新しく出した・公開に戻った）、そのお店の今日のキャンセル待ちに1回だけ知らせを積む
create or replace function public.notify_cancel_waits()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  w record;
  v_salon public.salons;
  v_menu public.menus;
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  if new.status <> 'open' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'open' then return new; end if;
  if (new.start_at at time zone 'Asia/Tokyo')::date <> v_today or new.deadline_at <= now() then return new; end if;
  if not public.salon_is_listed(new.salon_id) then return new; end if;

  select * into v_salon from public.salons where id = new.salon_id;
  select * into v_menu from public.menus where id = new.menu_id;
  for w in
    select cw.id, coalesce(p.email, u.email) as email, p.display_name
    from public.cancel_waits cw
    join auth.users u on u.id = cw.user_id
    left join public.profiles p on p.id = cw.user_id
    where cw.salon_id = new.salon_id and cw.day = v_today and cw.notified_at is null
    for update of cw skip locked
  loop
    if w.email is not null then
      insert into public.notification_outbox (dedupe_key, kind, channel, salon_id, recipient, payload)
      values ('cancel_wait:' || w.id || ':' || new.id, 'cancel_wait_mail', 'email', new.salon_id, w.email,
              jsonb_build_object('salon_name', v_salon.name, 'start_at', new.start_at, 'end_at', new.end_at,
                                 'menu_name', v_menu.name, 'price', new.price, 'display_name', w.display_name,
                                 'slot_id', new.id))
      on conflict (dedupe_key) do nothing;
    end if;
    update public.cancel_waits set notified_at = now() where id = w.id;
  end loop;
  return new;
end;
$$;

drop trigger if exists slots_notify_cancel_waits on public.slots;
create trigger slots_notify_cancel_waits
  after insert or update of status on public.slots
  for each row execute function public.notify_cancel_waits();

-- ---------- デモのリセット：キャンセル待ちの片付けと見本（それ以外は 0019 と同じ） ----------
create or replace function public.demo_reset(p_with_history boolean default false)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_today_start timestamptz := public.jst_today_start();
  v_today_end   timestamptz := public.jst_today_end();
  v_slots int := 0;
  v_hist_slots int := 0;
  v_hist_bookings int := 0;
  rec record;
  v_start timestamptz;
  v_base  timestamptz;
  v_menu public.menus;
  d int;
  i int;
  v_slot public.slots;
  v_user record;
  v_booking_id uuid;
  v_status text;
  v_created timestamptz;
  v_booked_at timestamptz;
begin
  -- デモ用のお店の今日のキャンセル待ちを消す（0020。枠を作り直したときに、古い待ちへ知らせを積まないように）
  delete from public.cancel_waits
  where salon_id = any (public.demo_salon_ids()) and day = (now() at time zone 'Asia/Tokyo')::date;

  -- 今日の予約と枠（デモ用のサロンの分）を消す。通知ログも合わせて消す
  delete from public.notification_outbox
  where booking_id in (
    select b.id from public.bookings b join public.slots s on s.id = b.slot_id
    where s.salon_id = any (public.demo_salon_ids()) and not s.demo_history and s.start_at >= v_today_start
  ) or (salon_id = any (public.demo_salon_ids()) and created_at >= v_today_start);
  delete from public.bookings
  where slot_id in (
    select id from public.slots
    where salon_id = any (public.demo_salon_ids()) and not demo_history and start_at >= v_today_start
  );
  delete from public.slots
  where salon_id = any (public.demo_salon_ids()) and not demo_history and start_at >= v_today_start;

  -- 運営の画面で掲載を止めたデモ用のお店を、掲載に戻す（止めたままだと、作った枠が利用者に見えない）
  update public.salons set is_approved = true where id = any (public.demo_salon_ids()) and not is_approved;
  -- デモ用の利用者の無断キャンセルの記録を消す（試しに2回記録すると、90日間予約できなくなるため）
  delete from public.no_show_records
  where public.norm_phone(phone) in (
    select public.norm_phone(p.phone) from public.profiles p join auth.users u on u.id = p.id
    where u.email like 'user%@demo.test' and p.phone is not null
  );
  -- 今日の予約番号を1から振り直す（今日の予約は上で消している）
  delete from public.booking_counters
  where salon_id = any (public.demo_salon_ids()) and day = (now() at time zone 'Asia/Tokyo')::date;

  -- デモ用の利用者に残っている「終わっていない予約」を閉じる（1アカウント1件のため）
  update public.bookings b set status = 'completed', completed_at = now(), updated_at = now()
  from public.slots s
  where s.id = b.slot_id and b.status = 'confirmed' and s.end_at > now()
    and b.user_id in (select id from auth.users where email like 'user%@demo.test');

  -- 今の時刻から見た、今日の空き枠。営業前（9時より前）なら9時を起点にする（夜や早朝でもデモを始められる）
  v_base := greatest(now(), ((now() at time zone 'Asia/Tokyo')::date + time '09:00') at time zone 'Asia/Tokyo');
  for rec in
    select * from (values
      ('11111111-1111-4111-8111-111111111111'::uuid, 'd1111111-1111-4111-8111-111111111111'::uuid, 25),
      ('22222222-2222-4222-8222-222222222222'::uuid, 'd2222221-2222-4222-8222-222222222222'::uuid, 45),
      ('33333333-3333-4333-8333-333333333333'::uuid, 'd3333331-3333-4333-8333-333333333333'::uuid, 60),
      ('11111111-1111-4111-8111-111111111111'::uuid, 'd1111112-1111-4111-8111-111111111111'::uuid, 90),
      ('11111111-1111-4111-8111-111111111111'::uuid, 'd1111111-1111-4111-8111-111111111111'::uuid, 150),
      ('22222222-2222-4222-8222-222222222222'::uuid, 'd2222221-2222-4222-8222-222222222222'::uuid, 240),
      -- ホームの入口「ネイルをしたい」「自分をケアしたい」で選べる枠（0019）
      ('33333333-3333-4333-8333-333333333333'::uuid, 'd3333332-3333-4333-8333-333333333333'::uuid, 35),
      ('22222222-2222-4222-8222-222222222222'::uuid, 'd2222223-2222-4222-8222-222222222222'::uuid, 70),
      ('33333333-3333-4333-8333-333333333333'::uuid, 'd3333332-3333-4333-8333-333333333333'::uuid, 120),
      ('22222222-2222-4222-8222-222222222222'::uuid, 'd2222223-2222-4222-8222-222222222222'::uuid, 195)
    ) as v(salon_id, menu_id, offset_min)
  loop
    select * into v_menu from public.menus where id = rec.menu_id;
    if v_menu.id is null then continue; end if;
    -- 受付の締切に間に合う時刻にする（サロンがメニューの締切を長くしても、予定した枠が消えないように）
    v_start := date_bin('5 minutes',
                        v_base + make_interval(mins => greatest(rec.offset_min, v_menu.booking_deadline_min + 15)) + interval '4 minutes',
                        timestamptz '2000-01-01');
    if v_start >= v_today_end or (v_start at time zone 'Asia/Tokyo')::time < time '09:00' then continue; end if;
    if v_start - make_interval(mins => v_menu.booking_deadline_min) <= now() then continue; end if;
    insert into public.slots (salon_id, menu_id, start_at, end_at, price)
    values (rec.salon_id, v_menu.id, v_start, v_start + make_interval(mins => v_menu.duration_min), v_menu.price);
    v_slots := v_slots + 1;
  end loop;

  -- 見本のキャンセル待ち（0020）：HAIR ROOM AOI に、デモ用のお客様（user3）が1件。次に枠を出すと、メールの知らせが積まれる
  insert into public.cancel_waits (salon_id, user_id)
  select '11111111-1111-4111-8111-111111111111'::uuid, u.id
  from auth.users u where u.email = 'user3@demo.test'
  on conflict (salon_id, user_id, day) do update set notified_at = null, created_at = now();

  if p_with_history then
    -- 以前に作った架空データを消してから作り直す
    delete from public.bookings where demo_history;
    delete from public.slots where demo_history;
    delete from public.no_show_records where phone = public.demo_suspended_phone();

    for d in 1..7 loop
      for rec in select id from public.salons where id = any (public.demo_salon_ids()) loop
        for i in 1..(3 + floor(random() * 4))::int loop
          select * into v_menu from public.menus
          where salon_id = rec.id and is_active and booking_deadline_min <= 30
          order by random() limit 1;
          if v_menu.id is null then continue; end if;
          v_start := (((now() at time zone 'Asia/Tokyo')::date - d) + time '10:00' + make_interval(mins => (floor(random() * 108) * 5)::int))
                     at time zone 'Asia/Tokyo';
          v_created := v_start - make_interval(mins => (20 + floor(random() * 160))::int);

          insert into public.slots (salon_id, menu_id, start_at, end_at, price, status, created_at, deadline_at, demo_history)
          values (rec.id, v_menu.id, v_start, v_start + make_interval(mins => v_menu.duration_min), v_menu.price,
                  'expired', v_created, v_start - make_interval(mins => v_menu.booking_deadline_min), true)
          returning * into v_slot;
          v_hist_slots := v_hist_slots + 1;

          if random() < 0.65 then
            select p.* into v_user
            from public.profiles p join auth.users u on u.id = p.id
            where u.email like 'user%@demo.test'
              and (p.gender is null or exists (
                select 1 from public.salons sx where sx.id = rec.id and p.gender = any (sx.accepts_genders)))
            order by random() limit 1;
            if v_user.id is null then continue; end if;

            v_booked_at := v_created + (v_slot.deadline_at - v_created) * random();
            v_status := case when random() < 0.86 then 'completed'
                             when random() < 0.5 then 'no_show'
                             else 'cancelled_by_customer' end;

            insert into public.bookings (slot_id, user_id, contact_name, contact_phone, contact_email, status,
                                         created_at, updated_at, completed_at, cancelled_at, demo_history)
            values (v_slot.id, v_user.id, v_user.display_name, v_user.phone, v_user.email, v_status,
                    v_booked_at, v_booked_at,
                    case when v_status = 'completed' then v_slot.end_at end,
                    case when v_status = 'cancelled_by_customer' then v_booked_at + interval '10 minutes' end,
                    true)
            returning id into v_booking_id;
            update public.slots set status = case when v_status = 'cancelled_by_customer' then 'closed' else 'booked' end
            where id = v_slot.id;
            insert into public.booking_demographics (booking_id, age_group, occupation)
            values (v_booking_id, v_user.age_group, v_user.occupation);

            if random() < 0.7 then
              insert into public.survey_answers (booking_id, question_id, answer, answered_at)
              select v_booking_id, q.id, q.choices[1 + floor(random() * cardinality(q.choices))::int], v_booked_at
              from public.survey_questions q where q.is_active;
            end if;
            v_hist_bookings := v_hist_bookings + 1;
          end if;
        end loop;
      end loop;
    end loop;

    -- アカウント削除済みの人の無断キャンセル記録（90日間は残る）
    insert into public.no_show_records (phone, salon_id, recorded_at) values
      (public.demo_suspended_phone(), '11111111-1111-4111-8111-111111111111', now() - interval '40 days'),
      (public.demo_suspended_phone(), '22222222-2222-4222-8222-222222222222', now() - interval '6 days');
  end if;

  return jsonb_build_object(
    'open_slots', v_slots,
    'history_slots', v_hist_slots,
    'history_bookings', v_hist_bookings
  );
end;
$$;

-- デモのリセットは、サーバー側（service_role）からだけ呼べる（0011 と同じ）
revoke execute on function public.demo_reset(boolean) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.demo_reset(boolean) to service_role;
  end if;
end;
$$;
