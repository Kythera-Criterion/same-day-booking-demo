-- =========================================================
-- 0016 デモの利用の記録（訪問ごとの利用時間と、そのアカウントに送った通知の件数）
--   訪問ごとに次の内容を残す（画面には出さない。記録することは /legal に記載）
--     ・利用時間（ページが前面に出ていた時間の合計。秒）・見たページの数・最初と最後のページ・端末の種類
--     ・ログインしていれば、そのアカウント（お客様・サロン・運営の別とメールアドレス）
--   通知の件数は、通知の送信待ち（notification_outbox）のうち、そのメールアドレスに宛てたものを数える
--   IP アドレスは残さない。ログインしていない訪問は、ブラウザごとの無作為の番号だけ
--   書き込みは画面から直接ではなく、app/api/usage の Route Handler が usage_track・usage_set_account を呼ぶ
--     アカウントは、Route Handler がログインのトークンを確かめてから書く（画面が名乗ったメールアドレスは使わない）
--   運営だけが読めて、運営だけが選んで削除・すべて削除できる（admin_usage_visits・admin_usage_delete・admin_usage_delete_all）
-- 0001〜0015 のあとに流す。何度流しても同じ結果になる
-- =========================================================

create table if not exists public.usage_visits (
  id            uuid primary key,
  visitor_id    uuid not null,
  started_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  active_sec    int not null default 0 check (active_sec >= 0),
  page_views    int not null default 1 check (page_views >= 0),
  first_path    text not null default '/',
  last_path     text not null default '/',
  device        text not null default 'pc' check (device in ('phone', 'tablet', 'pc')),
  account_user_id uuid,
  account_email   text,
  account_role    text check (account_role in ('user', 'salon', 'admin'))
);
create index if not exists usage_visits_started_idx on public.usage_visits (started_at desc);
create index if not exists usage_visits_visitor_idx on public.usage_visits (visitor_id);
create index if not exists usage_visits_email_idx on public.usage_visits (lower(account_email));
create index if not exists notification_outbox_recipient_idx on public.notification_outbox (lower(recipient));

alter table public.usage_visits enable row level security;
drop policy if exists usage_visits_admin_select on public.usage_visits;
create policy usage_visits_admin_select on public.usage_visits for select using (public.is_admin());
revoke all on public.usage_visits from anon, authenticated;
grant select on public.usage_visits to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.usage_visits to service_role;
  end if;
end;
$$;

-- ---------------------------------------------------------
-- 記録する（だれでも呼べる。Route Handler から呼ぶ）
--   p_kind：'start'（訪問の始まり・別のページへ移った）・'beat'（前面に出ていた秒数を足す）
--   1回で足せる秒数は 120 秒まで（画面は15秒ごと・離れるときに送る）。1つの訪問は 24 時間まで
--   別のブラウザの番号では、ほかの人の訪問を書き換えられない
-- ---------------------------------------------------------
create or replace function public.usage_track(
  p_visit_id uuid,
  p_visitor_id uuid,
  p_kind text,
  p_path text default null,
  p_seconds int default 0,
  p_device text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_path text := left(coalesce(nullif(p_path, ''), '/'), 200);
  v_device text := case when p_device in ('phone', 'tablet', 'pc') then p_device else 'pc' end;
  v_sec int := greatest(0, least(coalesce(p_seconds, 0), 120));
  v_row public.usage_visits%rowtype;
begin
  if p_visit_id is null or p_visitor_id is null or p_kind not in ('start', 'beat') then
    raise exception 'invalid';
  end if;

  -- 初めての知らせなら行を作る（同時に届いても1行だけ。作ったあとは、下の更新で中身を足す）
  insert into public.usage_visits (id, visitor_id, first_path, last_path, device)
  values (p_visit_id, p_visitor_id, v_path, v_path, v_device)
  on conflict (id) do nothing;

  select * into v_row from public.usage_visits where id = p_visit_id for update;
  if v_row.visitor_id <> p_visitor_id then raise exception 'forbidden'; end if;
  if v_row.started_at < now() - interval '24 hours' then return; end if;

  update public.usage_visits set
    last_seen_at  = now(),
    active_sec    = active_sec + case when p_kind = 'beat' then v_sec else 0 end,
    page_views    = page_views + case when p_kind = 'start' and v_path <> last_path then 1 else 0 end,
    last_path     = v_path
  where id = p_visit_id;
end;
$$;
revoke execute on function public.usage_track(uuid, uuid, text, text, int, text) from public;
grant execute on function public.usage_track(uuid, uuid, text, text, int, text) to anon, authenticated;

-- ---------------------------------------------------------
-- 訪問にアカウントを結びつける（サーバー側からだけ呼べる）
--   Route Handler がログインのトークンを確かめ、そのアカウントの番号とメールアドレスを渡す
--   訪問の途中でログイン・切り替えをしたときは、最後のアカウントにする
-- ---------------------------------------------------------
create or replace function public.usage_set_account(
  p_visit_id uuid,
  p_visitor_id uuid,
  p_user_id uuid,
  p_email text,
  p_role text
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_role not in ('user', 'salon', 'admin') then raise exception 'invalid'; end if;
  update public.usage_visits set
    account_user_id = p_user_id,
    account_email   = left(p_email, 254),
    account_role    = p_role
  where id = p_visit_id and visitor_id = p_visitor_id;
end;
$$;
revoke execute on function public.usage_set_account(uuid, uuid, uuid, text, text) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.usage_set_account(uuid, uuid, uuid, text, text) to service_role;
  end if;
end;
$$;

-- ---------------------------------------------------------
-- 運営：記録の一覧（そのアカウントのメールアドレスに宛てた通知の件数つき。新しい順に500件まで）
-- ---------------------------------------------------------
create or replace function public.admin_usage_visits(p_from timestamptz default null)
returns table (
  id uuid, visitor_id uuid, started_at timestamptz, last_seen_at timestamptz, active_sec int, page_views int,
  first_path text, last_path text, device text, account_email text, account_role text, notifications int
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query
  select v.id, v.visitor_id, v.started_at, v.last_seen_at, v.active_sec, v.page_views,
         v.first_path, v.last_path, v.device, v.account_email, v.account_role,
         case when v.account_email is null then 0
              else (select count(*)::int from public.notification_outbox o where lower(o.recipient) = lower(v.account_email)) end
  from public.usage_visits v
  where p_from is null or v.started_at >= p_from
  order by v.started_at desc
  limit 500;
end;
$$;
revoke execute on function public.admin_usage_visits(timestamptz) from public, anon;
grant execute on function public.admin_usage_visits(timestamptz) to authenticated;

-- ---------------------------------------------------------
-- 運営：選んだ記録を削除する・すべて削除する（消した件数を返す）
-- ---------------------------------------------------------
create or replace function public.admin_usage_delete(p_ids uuid[])
returns int
language plpgsql security definer set search_path = public
as $$
declare
  n int;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  delete from public.usage_visits where id = any(coalesce(p_ids, '{}'));
  get diagnostics n = row_count;
  insert into public.audit_logs (actor, action, target_id) values (auth.uid(), 'usage_delete', null);
  return n;
end;
$$;
revoke execute on function public.admin_usage_delete(uuid[]) from public, anon;
grant execute on function public.admin_usage_delete(uuid[]) to authenticated;

create or replace function public.admin_usage_delete_all()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  n int;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  delete from public.usage_visits where true;
  get diagnostics n = row_count;
  insert into public.audit_logs (actor, action, target_id) values (auth.uid(), 'usage_delete_all', null);
  return n;
end;
$$;
revoke execute on function public.admin_usage_delete_all() from public, anon;
grant execute on function public.admin_usage_delete_all() to authenticated;
