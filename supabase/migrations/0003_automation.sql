-- =========================================================
-- 0003 自動で動く仕組み（0002 のあとに流す。何度流しても壊れない書き方にしている）
--
--   ・締切を過ぎた枠を「受付終了（expired）」にする（pg_cron で1分ごと）
--   ・予約の成立・キャンセルを「通知の送信待ち」に積む（トリガー）
--   ・送信待ちの取り出し（for update skip locked）と結果の記録
--   ・90日を過ぎた無断キャンセル記録の削除（pg_cron で毎日）
--   ・実証の数字の集計、実証終了時の削除・加工の試し実行
-- =========================================================

-- ---------------------------------------------------------
-- 時間切れの枠
-- ---------------------------------------------------------

-- 締切を過ぎても予約のない枠を受付終了にする。
-- 表示と予約の判定は時刻でも絞っているため、この処理が遅れても誤りは起きない
create or replace function public.expire_stale_slots()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  n int;
begin
  update public.slots set status = 'expired'
  where status = 'open' and deadline_at <= now();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 90日を過ぎた無断キャンセルの記録を消す（判定には使わなくなるため）
create or replace function public.purge_old_records()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  n int;
begin
  delete from public.no_show_records where recorded_at < now() - interval '90 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------
-- 通知の送信待ち
-- ---------------------------------------------------------

create table if not exists public.notification_outbox (
  id         bigserial primary key,
  dedupe_key text not null unique,              -- 同じ通知を二度積まない
  kind       text not null check (kind in ('booking_created', 'booking_cancelled', 'salon_cancel_mail')),
  channel    text not null check (channel in ('line', 'email')),
  salon_id   uuid references public.salons(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  recipient  text,                               -- LINE のグループ ID、またはメールアドレス
  payload    jsonb not null,
  status     text not null default 'pending'
             check (status in ('pending', 'sending', 'sent', 'simulated', 'failed')),
  attempts   int not null default 0,
  locked_at  timestamptz,
  sent_at    timestamptz,
  last_error text,
  response   jsonb,
  created_at timestamptz not null default now()
);
create index if not exists notification_outbox_pending_idx
  on public.notification_outbox (id) where status in ('pending', 'sending');
create index if not exists notification_outbox_salon_idx
  on public.notification_outbox (salon_id, created_at desc);

-- 予約の成立・キャンセルを積む。
--   サロンへの LINE：店舗名・日時・メニュー・金額・お名前のみ（電話番号とメールアドレスは載せない）
--   利用者へのメール：サロン都合のキャンセルのお知らせ（カルテ・写真・位置情報は載せない）
create or replace function public.enqueue_booking_notifications()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  s   public.slots;
  sal public.salons;
  m   public.menus;
  v_group text;
  v_base jsonb;
begin
  if new.demo_history then return new; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;

  select * into s   from public.slots  where id = new.slot_id;
  select * into sal from public.salons where id = s.salon_id;
  select * into m   from public.menus  where id = s.menu_id;
  select line_group_id into v_group from public.salon_private where salon_id = sal.id;

  v_base := jsonb_build_object(
    'salon_name', sal.name,
    'start_at',   s.start_at,
    'end_at',     s.end_at,
    'menu_name',  m.name,
    'price',      s.price
  );

  if tg_op = 'INSERT' and new.status = 'confirmed' then
    insert into public.notification_outbox (dedupe_key, kind, channel, salon_id, booking_id, recipient, payload)
    values ('booking_created:' || new.id, 'booking_created', 'line', sal.id, new.id, v_group,
            v_base || jsonb_build_object('customer_name', new.contact_name))
    on conflict (dedupe_key) do nothing;

  elsif tg_op = 'UPDATE' and new.status in ('cancelled_by_customer', 'cancelled_by_salon') then
    insert into public.notification_outbox (dedupe_key, kind, channel, salon_id, booking_id, recipient, payload)
    values ('booking_cancelled:' || new.id, 'booking_cancelled', 'line', sal.id, new.id, v_group,
            v_base || jsonb_build_object('customer_name', new.contact_name, 'reason', new.status))
    on conflict (dedupe_key) do nothing;

    if new.status = 'cancelled_by_salon' then
      insert into public.notification_outbox (dedupe_key, kind, channel, salon_id, booking_id, recipient, payload)
      values ('salon_cancel_mail:' || new.id, 'salon_cancel_mail', 'email', sal.id, new.id, new.contact_email,
              v_base || jsonb_build_object('customer_name', new.contact_name, 'salon_phone', sal.phone))
      on conflict (dedupe_key) do nothing;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_enqueue_notifications on public.bookings;
create trigger bookings_enqueue_notifications
  after insert or update of status on public.bookings
  for each row execute function public.enqueue_booking_notifications();

-- 送信する分を取り出す。複数の送信処理が同時に動いても、同じ通知は1つの処理にしか渡らない。
-- 送信中のまま2分たったもの（処理が途中で止まった場合）は取り出し直す。5回失敗したら諦める
create or replace function public.claim_notifications(p_limit int default 10)
returns setof public.notification_outbox
language plpgsql security definer set search_path = public
as $$
begin
  update public.notification_outbox set status = 'failed', last_error = coalesce(last_error, 'too_many_attempts')
  where status in ('pending', 'sending') and attempts >= 5;

  return query
  update public.notification_outbox o
  set status = 'sending', locked_at = now(), attempts = o.attempts + 1
  where o.id in (
    select id from public.notification_outbox
    where status = 'pending' or (status = 'sending' and locked_at < now() - interval '2 minutes')
    order by id
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  )
  returning o.*;
end;
$$;

-- 送信の結果を記録する（送信中のものだけ。二重に記録しない）
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
      locked_at = null
  where id = p_id and status = 'sending';
  return found;
end;
$$;

alter table public.notification_outbox enable row level security;

-- サロンは自店宛ての LINE 通知だけ、運営はすべて見られる
drop policy if exists notification_outbox_select on public.notification_outbox;
create policy notification_outbox_select on public.notification_outbox
  for select using (
    (channel = 'line' and public.is_salon_member(salon_id))
    or public.is_admin()
  );

revoke all on public.notification_outbox from anon, authenticated;
grant select on public.notification_outbox to authenticated;

-- ---------------------------------------------------------
-- 実証の数字（運営だけ。期間は日本時間の日付で、枠の開始日で数える）
-- ---------------------------------------------------------
create or replace function public.admin_metrics(p_from date, p_to date, p_min_days int default 3)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  r jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then raise exception 'invalid_input'; end if;
  if p_min_days not between 1 and 7 then raise exception 'invalid_input'; end if;

  with
  s as (
    select sl.*, (sl.start_at at time zone 'Asia/Tokyo')::date as d
    from public.slots sl
    where (sl.start_at at time zone 'Asia/Tokyo')::date between p_from and p_to
  ),
  b as (
    select bk.*, s.d, s.salon_id, s.start_at as slot_start, s.created_at as slot_created_at
    from public.bookings bk join s on s.id = bk.slot_id
  ),
  first_b as (
    select distinct on (slot_id) slot_id, created_at, slot_created_at
    from b order by slot_id, created_at
  ),
  totals as (
    select
      (select count(*) from s)                                         as published,
      (select count(*) from b)                                         as bookings,
      (select count(distinct slot_id) from b)                          as booked_slots,
      (select count(*) from b where status = 'completed')              as completed,
      (select count(*) from b where status = 'no_show')                as no_show,
      (select count(*) from b where status like 'cancelled%')          as cancelled,
      (select round(avg(extract(epoch from (created_at - slot_created_at)) / 60)::numeric, 1)
         from first_b)                                                 as avg_minutes_to_booking
  ),
  approved as (
    select id from public.salons where is_approved
  ),
  continuing as (
    select sl.salon_id
    from public.slots sl
    where sl.salon_id in (select id from approved)
      and (sl.created_at at time zone 'Asia/Tokyo')::date between p_to - 6 and p_to
    group by sl.salon_id
    having count(distinct (sl.created_at at time zone 'Asia/Tokyo')::date) >= p_min_days
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'published_slots', t.published,
    'bookings', t.bookings,
    'booked_slots', t.booked_slots,
    'completed', t.completed,
    'no_show', t.no_show,
    'cancelled', t.cancelled,
    'conversion_rate', case when t.published > 0 then round(t.booked_slots::numeric / t.published, 4) end,
    'visit_rate', case when t.completed + t.no_show > 0
                       then round(t.completed::numeric / (t.completed + t.no_show), 4) end,
    'avg_minutes_to_booking', t.avg_minutes_to_booking,
    'continuing', jsonb_build_object(
      'min_days', p_min_days,
      'window_from', p_to - 6,
      'window_to', p_to,
      'salons', (select count(*) from continuing),
      'approved_salons', (select count(*) from approved),
      'rate', case when (select count(*) from approved) > 0
                   then round((select count(*) from continuing)::numeric / (select count(*) from approved), 4) end
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'date', g.d,
               'published', (select count(*) from s where s.d = g.d),
               'bookings', (select count(*) from b where b.d = g.d),
               'completed', (select count(*) from b where b.d = g.d and b.status = 'completed')
             ) order by g.d), '[]'::jsonb)
      from (select generate_series(p_from, p_to, interval '1 day')::date as d) g
    ),
    'by_hour', (
      select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'bookings', n) order by h), '[]'::jsonb)
      from (
        select extract(hour from (slot_start at time zone 'Asia/Tokyo'))::int as h, count(*) as n
        from b group by 1
      ) x
    ),
    'by_salon', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'salon_id', sa.id, 'salon_name', sa.name,
               'published', (select count(*) from s where s.salon_id = sa.id),
               'bookings', (select count(*) from b where b.salon_id = sa.id),
               'completed', (select count(*) from b where b.salon_id = sa.id and b.status = 'completed'),
               'no_show', (select count(*) from b where b.salon_id = sa.id and b.status = 'no_show')
             ) order by sa.name), '[]'::jsonb)
      from public.salons sa
      where sa.is_approved or exists (select 1 from s where s.salon_id = sa.id)
    ),
    'by_age_group', (
      select coalesce(jsonb_agg(jsonb_build_object('label', k, 'bookings', n) order by k), '[]'::jsonb)
      from (
        select coalesce(dm.age_group, 'unknown') as k, count(*) as n
        from b left join public.booking_demographics dm on dm.booking_id = b.id
        group by 1
      ) x
    ),
    'by_occupation', (
      select coalesce(jsonb_agg(jsonb_build_object('label', k, 'bookings', n) order by n desc, k), '[]'::jsonb)
      from (
        select coalesce(dm.occupation, 'unknown') as k, count(*) as n
        from b left join public.booking_demographics dm on dm.booking_id = b.id
        group by 1
      ) x
    ),
    'survey', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'question_id', q.id, 'question', q.body,
               'answers', (
                 select coalesce(jsonb_agg(jsonb_build_object('answer', c.choice, 'count', (
                   select count(*) from public.survey_answers a
                   where a.question_id = q.id and a.answer = c.choice
                     and a.booking_id in (select id from b)
                 )) order by c.ord), '[]'::jsonb)
                 from unnest(q.choices) with ordinality as c(choice, ord)
               ),
               'responses', (
                 select count(*) from public.survey_answers a
                 where a.question_id = q.id and a.booking_id in (select id from b)
               )
             ) order by q.sort_order), '[]'::jsonb)
      from public.survey_questions q
    )
  )
  into r
  from totals t;

  return r;
end;
$$;

-- 実証終了時の個人情報の削除・加工：対象件数だけを数える（試し実行）
create or replace function public.admin_trial_end_dry_run()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r jsonb;
  v_photos bigint := 0;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;

  if to_regclass('storage.objects') is not null then
    execute $q$select count(*) from storage.objects where bucket_id = 'hair-photos'$q$ into v_photos;
  end if;

  r := jsonb_build_object(
    'executed_at', now(),
    'dry_run', true,
    'items', jsonb_build_array(
      jsonb_build_object('key', 'profiles', 'action', 'delete',
        'count', (select count(*) from public.profiles p
                  where not exists (select 1 from public.salon_members m where m.user_id = p.id)
                    and not exists (select 1 from public.admins a where a.user_id = p.id))),
      jsonb_build_object('key', 'booking_contacts', 'action', 'anonymize',
        'count', (select count(*) from public.bookings
                  where contact_name <> '' or contact_phone is not null or contact_email is not null)),
      jsonb_build_object('key', 'booking_kartes', 'action', 'delete',
        'count', (select count(*) from public.bookings
                  where karte is not null and karte <> '{}'::jsonb or note is not null or photo_note is not null)),
      jsonb_build_object('key', 'hair_photos', 'action', 'delete', 'count', v_photos),
      jsonb_build_object('key', 'no_show_records', 'action', 'delete',
        'count', (select count(*) from public.no_show_records)),
      jsonb_build_object('key', 'notification_recipients', 'action', 'anonymize',
        'count', (select count(*) from public.notification_outbox where recipient is not null or payload ? 'customer_name')),
      jsonb_build_object('key', 'salon_applications', 'action', 'anonymize',
        'count', (select count(*) from public.salon_applications)),
      jsonb_build_object('key', 'consents', 'action', 'keep',
        'count', (select count(*) from public.consents)),
      jsonb_build_object('key', 'booking_demographics', 'action', 'keep',
        'count', (select count(*) from public.booking_demographics)),
      jsonb_build_object('key', 'survey_answers', 'action', 'keep',
        'count', (select count(*) from public.survey_answers))
    )
  );

  insert into public.audit_logs (actor, action, detail) values (auth.uid(), 'trial_end_dry_run', r);
  return r;
end;
$$;

-- ---------------------------------------------------------
-- 権限
-- ---------------------------------------------------------
do $$
declare
  f text;
begin
  -- サーバー側（service_role）と定期実行だけが呼ぶ関数
  foreach f in array array[
    'public.expire_stale_slots()',
    'public.purge_old_records()',
    'public.claim_notifications(int)',
    'public.finish_notification(bigint, text, text, jsonb)',
    'public.enqueue_booking_notifications()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;

  -- 運営が呼ぶ関数（中で is_admin() を確かめる）
  foreach f in array array[
    'public.admin_metrics(date, date, int)',
    'public.admin_trial_end_dry_run()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------
-- リアルタイム配信（通知ログ）
-- ---------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notification_outbox'
     ) then
    alter publication supabase_realtime add table public.notification_outbox;
  end if;
end;
$$;

-- ---------------------------------------------------------
-- 定期実行（pg_cron が使えない環境ではスキップする）
-- ---------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron が使えないため、定期実行の登録をスキップしました（README を参照）';
    return;
  end if;

  begin
    create extension if not exists pg_cron with schema pg_catalog;
  exception when others then
    create extension if not exists pg_cron;
  end;

  -- 同じ名前で登録し直すと、上書きされる
  perform cron.schedule('expire-stale-slots', '* * * * *', 'select public.expire_stale_slots()');
  perform cron.schedule('purge-old-records', '15 18 * * *', 'select public.purge_old_records()');
exception when others then
  raise notice 'pg_cron の設定に失敗しました（%）。README の手順で有効化してください', sqlerrm;
end;
$$;
