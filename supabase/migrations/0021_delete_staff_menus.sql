-- 0021：美容師・メニューの削除（サロンの設定）
--   ・今日の公開中の枠・まだ来店していない予約があるあいだは、削除できない（先に枠を取り下げるか、担当を変える）
--   ・美容師：削除する。過去の枠の担当は「担当なし」になり、いつもの枠の担当も外れる
--   ・メニュー：過去の枠・予約に使ったことがあれば、記録を残すため「削除済み」にして画面から外す（もう選べない）。
--     使ったことがなければ、そのまま消す（そのメニューのいつもの枠も消える）
--   ・デモのリセットで、デモ用のお店の美容師・メニューは元に戻る（削除済みのメニューでは枠を作らない）
-- 2回流しても壊れない

alter table public.menus add column if not exists deleted_at timestamptz;

-- 今日、その美容師・メニューに、公開中の枠か、まだ終わっていない予約がある
create or replace function public.has_active_today(p_salon_id uuid, p_menu_id uuid, p_stylist_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.slots s
    where s.salon_id = p_salon_id
      and (p_menu_id is null or s.menu_id = p_menu_id)
      and (p_stylist_id is null or s.stylist_id = p_stylist_id)
      and s.end_at > now()
      and (s.status = 'open'
           or exists (select 1 from public.bookings b where b.slot_id = s.id and b.status = 'confirmed'))
  );
$$;
revoke execute on function public.has_active_today(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.salon_delete_stylist(p_salon_id uuid, p_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_salon_member(p_salon_id) then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.stylists where id = p_id and salon_id = p_salon_id) then
    raise exception 'stylist_not_found';
  end if;
  if public.has_active_today(p_salon_id, null, p_id) then raise exception 'stylist_has_slots'; end if;
  delete from public.stylists where id = p_id and salon_id = p_salon_id;
  return 'deleted';
end;
$$;

create or replace function public.salon_delete_menu(p_salon_id uuid, p_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_salon_member(p_salon_id) then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.menus where id = p_id and salon_id = p_salon_id and deleted_at is null) then
    raise exception 'menu_not_found';
  end if;
  if public.has_active_today(p_salon_id, p_id, null) then raise exception 'menu_has_slots'; end if;
  if exists (select 1 from public.slots where menu_id = p_id) then
    -- 過去の枠・予約の記録に使っているので、消さずに「削除済み」にする（いつもの枠からも外す）
    delete from public.slot_presets where menu_id = p_id;
    update public.menus set is_active = false, deleted_at = now() where id = p_id;
    return 'archived';
  end if;
  delete from public.menus where id = p_id and salon_id = p_salon_id;
  return 'deleted';
end;
$$;
revoke execute on function public.salon_delete_stylist(uuid, uuid) from public, anon;
revoke execute on function public.salon_delete_menu(uuid, uuid) from public, anon;
grant execute on function public.salon_delete_stylist(uuid, uuid) to authenticated;
grant execute on function public.salon_delete_menu(uuid, uuid) to authenticated;

-- ---------- デモのリセット（0020 に、削除したメニューを使わないこと・デモ用の美容師とメニューを戻すことを足した） ----------
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

  -- デモ用のお店の美容師・メニューを戻す（0021。デモの中で削除しても、リセットで元に戻る。名前・価格などの変更はそのまま）
  insert into public.menus (id, salon_id, name, duration_min, price, booking_deadline_min) values
    ('d1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'カット（シャンプー・ブロー込み）', 60, 4500, 10),
    ('d1111112-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '前髪カット', 15, 1100, 10),
    ('d2222221-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'カット（シャンプー・ブロー込み）', 50, 5200, 10),
    ('d2222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'カット＋カラー', 120, 9800, 180),
    ('d2222223-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'ヘッドケア・スパ', 40, 4400, 10),
    ('d3333331-3333-4333-8333-333333333333', '33333333-3333-4333-8333-333333333333', 'カット（シャンプー・ブロー込み）', 60, 4800, 10),
    ('d3333332-3333-4333-8333-333333333333', '33333333-3333-4333-8333-333333333333', 'ハンドネイル（単色）', 60, 5500, 10)
  on conflict (id) do update set deleted_at = null, is_active = true where public.menus.deleted_at is not null;
  insert into public.stylists (id, salon_id, name, styles) values
    ('a1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '佐藤', array['ショート','メンズカット']),
    ('a2222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', '高橋', array['ボブ','レイヤー']),
    ('b1111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '伊藤', array['ロング','前髪カット']),
    ('c1111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', '中村', array['ボブ','ショート'])
  on conflict (id) do nothing;

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
    if v_menu.id is null or v_menu.deleted_at is not null then continue; end if;
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
          where salon_id = rec.id and is_active and deleted_at is null and booking_deadline_min <= 30
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
