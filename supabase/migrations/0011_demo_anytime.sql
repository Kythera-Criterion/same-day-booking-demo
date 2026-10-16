-- =========================================================
-- 0011 デモのリセットを、いつでも使えるようにする（0010 のあとに流す。何度流しても壊れない）
--
--   ・これまでは「今の時刻から○分後」に枠を作っていたため、9時より前（夜・早朝）は1枠も作れなかった。
--     9時より前なら、9時を起点に作る（枠は今日の 9:00〜23:59 開始という決まりはそのまま）
--   ・サロンがメニューの受付締切を長くしても（例：60分前）、予定した枠が締切切れで消えないようにする
-- =========================================================

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
      ('22222222-2222-4222-8222-222222222222'::uuid, 'd2222221-2222-4222-8222-222222222222'::uuid, 240)
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

revoke execute on function public.demo_reset(boolean) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.demo_reset(boolean) to service_role;
  end if;
end;
$$;
