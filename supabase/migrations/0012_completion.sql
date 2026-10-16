-- =========================================================
-- 0012 いまある機能の仕上げ（0011 のあとに流す。何度流しても壊れない）
--
--   ・予約のキャンセル：掲載中でないお店・「今日はここまで」のあとのお店では、枠を公開に戻さない
--   ・「元に戻す」：掲載中でないお店では断る（戻しても利用者に見えないため）
--   ・運営の「掲載を再開」：審査中・見送りのお店は、承認を通さずに掲載しない
--   ・お店の場所：エリアを必須にする（エリアのないお店は、利用者の検索に出ない）
--   ・通知の送り直し：1・2・4・8分と間をあけて送り直す。送信中のものを途中で「失敗」にしない
--   ・デモのリセット：止めたデモ用のお店を掲載に戻し、デモ用の利用者の無断キャンセルの記録と今日の予約番号を戻す
--   ・同時予約チャレンジ：開始が今日中なら枠を作る（夜遅くでも）
--   ・パスワードの再設定のメールを、このサービスから送る（送信待ちの種類に加える）
-- =========================================================

alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check
  check (kind in ('booking_created', 'booking_cancelled', 'salon_cancel_mail', 'salon_welcome_mail',
                  'salon_approved_mail', 'salon_rejected_mail', 'admin_invite_mail',
                  'signup_confirm_mail', 'account_exists_mail', 'password_reset_mail'));

create or replace function public.salon_update_booking(p_booking_id uuid, p_action text)
returns public.bookings
language plpgsql security definer set search_path = public
as $$
declare
  b public.bookings;
  s public.slots;
  v_action text := case when p_action = 'cancel' then 'cancel_salon' else p_action end;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'booking_not_found'; end if;
  select * into s from public.slots where id = b.slot_id for update;
  if not public.is_salon_member(s.salon_id) then raise exception 'forbidden'; end if;
  if b.status <> 'confirmed' then raise exception 'already_closed'; end if;

  if v_action = 'complete' then
    update public.bookings set status = 'completed', completed_at = now(), updated_at = now()
    where id = b.id returning * into b;

  elsif v_action = 'no_show' then
    if s.start_at > now() then raise exception 'not_started'; end if;
    update public.bookings set status = 'no_show', updated_at = now()
    where id = b.id returning * into b;
    if public.norm_phone(b.contact_phone) is not null then
      insert into public.no_show_records (phone, booking_id, salon_id)
      values (public.norm_phone(b.contact_phone), b.id, s.salon_id);
    end if;

  elsif v_action in ('cancel_customer', 'cancel_salon') then
    update public.bookings
    set status = case when v_action = 'cancel_customer' then 'cancelled_by_customer' else 'cancelled_by_salon' end,
        cancelled_at = now(), updated_at = now()
    where id = b.id returning * into b;
    -- 締切前なら枠を公開に戻す。ただし、掲載中でないお店（審査中・停止中）や、
    -- 「今日はここまで」で受付を止めていて、ほかに公開中の枠がないお店では、戻さずに取り下げた状態にする
    if s.deadline_at <= now() then
      update public.slots set status = 'closed' where id = s.id;
    elsif not public.salon_is_listed(s.salon_id) then
      update public.slots set status = 'closed', closed_reason = 'suspended', closed_at = now() where id = s.id;
    elsif exists (
      select 1 from public.slots x
      where x.salon_id = s.salon_id and x.id <> s.id and x.status = 'closed' and x.closed_reason = 'paused'
        and x.start_at >= public.jst_today_start() and x.start_at < public.jst_today_end()
    ) and not exists (
      select 1 from public.slots x
      where x.salon_id = s.salon_id and x.status = 'open'
        and x.start_at >= public.jst_today_start() and x.start_at < public.jst_today_end()
    ) then
      update public.slots set status = 'closed', closed_reason = 'paused', closed_at = now() where id = s.id;
    else
      update public.slots set status = 'open', closed_reason = null, closed_at = null where id = s.id;
    end if;

  else
    raise exception 'invalid_action';
  end if;

  insert into public.audit_logs (actor, action, target_id)
  values (auth.uid(), 'booking_' || v_action, b.id);
  return b;
end;
$$;

create or replace function public.salon_resume_today(p_salon_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  v_reopened int := 0;
  v_skipped int := 0;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_salon_member(p_salon_id) then raise exception 'forbidden'; end if;
  if not public.salon_is_listed(p_salon_id) then raise exception 'salon_not_listed'; end if;

  for r in
    select id, deadline_at from public.slots
    where salon_id = p_salon_id and status = 'closed' and closed_reason = 'paused'
      and start_at >= public.jst_today_start() and start_at < public.jst_today_end()
    order by start_at
    for update
  loop
    if r.deadline_at <= now() then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    begin
      update public.slots set status = 'open', closed_reason = null, closed_at = null where id = r.id;
      v_reopened := v_reopened + 1;
    exception when exclusion_violation then
      -- 取り下げのあとに、同じ担当の重なる枠を出していた場合は戻さない
      v_skipped := v_skipped + 1;
    end;
  end loop;

  insert into public.audit_logs (actor, action, target_id, detail)
  values (auth.uid(), 'resume_today', p_salon_id, jsonb_build_object('reopened', v_reopened, 'skipped', v_skipped));
  return jsonb_build_object('reopened', v_reopened, 'skipped', v_skipped);
end;
$$;

create or replace function public.admin_set_salon_approved(p_salon_id uuid, p_approved boolean)
returns public.salons
language plpgsql security definer set search_path = public
as $$
declare
  s public.salons;
  r record;
  v_closed int := 0;
  v_reopened int := 0;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_approved is null then raise exception 'invalid_input'; end if;
  if p_approved and not exists (select 1 from public.salon_applications where salon_id = p_salon_id and status = 'approved') then
    if exists (select 1 from public.salon_applications where salon_id = p_salon_id and status = 'pending') then
      raise exception 'application_pending';
    end if;
    if exists (select 1 from public.salon_applications where salon_id = p_salon_id and status = 'rejected') then
      raise exception 'application_rejected';
    end if;
  end if;
  update public.salons set is_approved = p_approved where id = p_salon_id returning * into s;
  if not found then raise exception 'not_found'; end if;

  if not p_approved then
    update public.slots set status = 'closed', closed_reason = 'suspended', closed_at = now()
    where salon_id = p_salon_id and status = 'open';
    get diagnostics v_closed = row_count;
  else
    for r in
      select id from public.slots
      where salon_id = p_salon_id and status = 'closed' and closed_reason = 'suspended' and deadline_at > now()
      order by start_at
      for update
    loop
      begin
        update public.slots set status = 'open', closed_reason = null, closed_at = null where id = r.id;
        v_reopened := v_reopened + 1;
      exception when exclusion_violation then
        null;  -- 止めている間に、同じ担当の重なる枠が出ていたら戻さない
      end;
    end loop;
  end if;

  insert into public.audit_logs (actor, action, target_id, detail)
  values (auth.uid(), case when p_approved then 'resume_salon' else 'suspend_salon' end, p_salon_id,
          jsonb_build_object('closed_slots', v_closed, 'reopened_slots', v_reopened));
  return s;
end;
$$;

create or replace function public.salon_update_profile(
  p_salon_id uuid,
  p_name     text,
  p_address  text,
  p_area_id  uuid,
  p_lat      double precision,
  p_lng      double precision
)
returns public.salons
language plpgsql security definer set search_path = public
as $$
declare
  s public.salons;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_salon_member(p_salon_id) then raise exception 'forbidden'; end if;
  if coalesce(btrim(p_name), '') = '' or coalesce(btrim(p_address), '') = ''
     or p_lat is null or p_lng is null
     or p_lat not between 20 and 46 or p_lng not between 122 and 154 then
    raise exception 'invalid_input';
  end if;
  if p_area_id is null or not exists (select 1 from public.areas where id = p_area_id) then
    raise exception 'invalid_input';
  end if;

  update public.salons
  set name = left(btrim(p_name), 80), address = left(btrim(p_address), 120),
      area_id = p_area_id, lat = p_lat, lng = p_lng
  where id = p_salon_id
  returning * into s;

  insert into public.audit_logs (actor, action, target_id, detail)
  values (auth.uid(), 'update_salon_profile', p_salon_id,
          jsonb_build_object('area_id', p_area_id, 'lat', p_lat, 'lng', p_lng));
  return s;
end;
$$;

create or replace function public.claim_notifications(p_limit int default 10)
returns setof public.notification_outbox
language plpgsql security definer set search_path = public
as $$
begin
  -- 5回送っても届かなかったものは諦める（送信中のものは、止まってから2分たったものだけ）
  update public.notification_outbox set status = 'failed', last_error = coalesce(last_error, 'too_many_attempts')
  where attempts >= 5
    and (status = 'pending' or (status = 'sending' and locked_at < now() - interval '2 minutes'));

  return query
  update public.notification_outbox o
  set status = 'sending', locked_at = now(), attempts = o.attempts + 1
  where o.id in (
    select id from public.notification_outbox
    where (status = 'pending'
           and (locked_at is null or locked_at < now() - make_interval(mins => least(power(2, greatest(attempts - 1, 0))::int, 30))))
       or (status = 'sending' and locked_at < now() - interval '2 minutes')
    order by id
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  )
  returning o.*;
end;
$$;

create or replace function public.finish_notification(
  p_id       bigint,
  p_status   text,
  p_error    text default null,
  p_response jsonb default null
)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if p_status not in ('sent', 'simulated', 'failed', 'pending') then raise exception 'invalid_input'; end if;
  update public.notification_outbox
  set status = p_status,
      sent_at = case when p_status in ('sent', 'simulated') then now() end,
      last_error = p_error,
      response = p_response,
      -- 送り直す（pending）ときは、最後に送った時刻を残し、間をあけて送り直す
      locked_at = case when p_status = 'pending' then now() end
  where id = p_id and status = 'sending';
  return found;
end;
$$;

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

create or replace function public.demo_prepare_challenge()
returns public.slots
language plpgsql security definer set search_path = public
as $$
declare
  v_menu public.menus;
  v_start timestamptz;
  s public.slots;
begin
  update public.bookings b set status = 'completed', completed_at = now(), updated_at = now()
  from public.slots sl
  where sl.id = b.slot_id and b.status = 'confirmed' and sl.end_at > now()
    and b.user_id in (select id from auth.users where email like 'user%@demo.test');

  select * into v_menu from public.menus where id = 'd1111111-1111-4111-8111-111111111111';
  v_start := greatest(
    date_bin('5 minutes', now() + make_interval(mins => v_menu.booking_deadline_min + 30), timestamptz '2000-01-01'),
    ((now() at time zone 'Asia/Tokyo')::date + time '09:30') at time zone 'Asia/Tokyo'
  );
  if v_start >= public.jst_today_end() then
    raise exception 'today_only';
  end if;

  insert into public.slots (salon_id, menu_id, start_at, end_at, price)
  values (v_menu.salon_id, v_menu.id, v_start, v_start + make_interval(mins => v_menu.duration_min), v_menu.price)
  returning * into s;
  return s;
end;
$$;

-- 権限（作り直した関数の権限は、そのまま引き継がれる。念のため、画面側から呼べるものだけを並べ直す）
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.salon_update_booking(uuid, text)',
    'public.salon_resume_today(uuid)',
    'public.admin_set_salon_approved(uuid, boolean)',
    'public.salon_update_profile(uuid, text, text, uuid, double precision, double precision)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'public.claim_notifications(int)',
    'public.finish_notification(bigint, text, text, jsonb)',
    'public.demo_reset(boolean)',
    'public.demo_prepare_challenge()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end;
$$;
