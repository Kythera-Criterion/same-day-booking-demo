-- =========================================================
-- 0017 利用の記録：ページを開いたこと・使った機能を1件ずつ残し、/usage にすぐ届ける
--   ・usage_events：訪問ごとの出来事（page＝ページを開いた、feature＝ボタン・リンク・タブなどを押した）
--   ・ページを開くたびに page を1件（同じページの読み込み直しも数える）。押した操作は feature（押したものの名前と画面）
--   ・/usage は Realtime でこの表の追加と訪問の更新を受け取り、その場で知らせと一覧を出す（運営だけが受け取れる）
--   ・訪問の記録を削除すると、その訪問の出来事も消える
-- 0016 のあとに流す。何度流しても同じ結果になる
-- =========================================================

create table if not exists public.usage_events (
  id       bigserial primary key,
  visit_id uuid not null references public.usage_visits(id) on delete cascade,
  at       timestamptz not null default now(),
  kind     text not null check (kind in ('page', 'feature')),
  label    text,
  path     text not null default '/'
);
create index if not exists usage_events_visit_idx on public.usage_events (visit_id, at);
create index if not exists usage_events_at_idx on public.usage_events (at desc);

alter table public.usage_events enable row level security;
drop policy if exists usage_events_admin_select on public.usage_events;
create policy usage_events_admin_select on public.usage_events for select using (public.is_admin());
revoke all on public.usage_events from anon, authenticated;
grant select on public.usage_events to authenticated;
revoke all on sequence public.usage_events_id_seq from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, delete on public.usage_events to service_role;
  end if;
  -- /usage がその場で受け取れるよう、出来事の追加と訪問の更新を Realtime で流す（RLS で運営だけに届く）
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'usage_events') then
      alter publication supabase_realtime add table public.usage_events;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'usage_visits') then
      alter publication supabase_realtime add table public.usage_visits;
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------
-- 記録する（0016 の置き換え）
--   p_kind：'start'（ページを開いた）・'beat'（前面に出ていた秒数を足す）・'feature'（機能を使った。p_label に押したものの名前）
--   start と feature は、出来事（usage_events）にも1件ずつ残す。1つの訪問の出来事は 2000 件まで
-- ---------------------------------------------------------
drop function if exists public.usage_track(uuid, uuid, text, text, int, text);
create or replace function public.usage_track(
  p_visit_id uuid,
  p_visitor_id uuid,
  p_kind text,
  p_path text default null,
  p_seconds int default 0,
  p_device text default null,
  p_label text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_path text := left(coalesce(nullif(p_path, ''), '/'), 200);
  v_device text := case when p_device in ('phone', 'tablet', 'pc') then p_device else 'pc' end;
  v_sec int := greatest(0, least(coalesce(p_seconds, 0), 120));
  v_label text := nullif(left(btrim(regexp_replace(coalesce(p_label, ''), '\s+', ' ', 'g')), 80), '');
  v_new boolean;
  v_row public.usage_visits%rowtype;
begin
  if p_visit_id is null or p_visitor_id is null or p_kind not in ('start', 'beat', 'feature') then
    raise exception 'invalid';
  end if;
  if p_kind = 'feature' and v_label is null then raise exception 'invalid'; end if;

  -- 初めての知らせなら行を作る（同時に届いても1行だけ）
  insert into public.usage_visits (id, visitor_id, first_path, last_path, device)
  values (p_visit_id, p_visitor_id, v_path, v_path, v_device)
  on conflict (id) do nothing;
  v_new := found;

  select * into v_row from public.usage_visits where id = p_visit_id for update;
  if v_row.visitor_id <> p_visitor_id then raise exception 'forbidden'; end if;
  if v_row.started_at < now() - interval '24 hours' then return; end if;

  update public.usage_visits set
    last_seen_at = now(),
    active_sec   = active_sec + case when p_kind = 'beat' then v_sec else 0 end,
    page_views   = page_views + case when p_kind = 'start' and not v_new then 1 else 0 end,
    last_path    = case when p_kind = 'feature' then last_path else v_path end
  where id = p_visit_id;

  if p_kind in ('start', 'feature')
     and (select count(*) from public.usage_events where visit_id = p_visit_id) < 2000 then
    insert into public.usage_events (visit_id, kind, label, path)
    values (p_visit_id, case when p_kind = 'start' then 'page' else 'feature' end, case when p_kind = 'feature' then v_label end, v_path);
  end if;
end;
$$;
revoke execute on function public.usage_track(uuid, uuid, text, text, int, text, text) from public;
grant execute on function public.usage_track(uuid, uuid, text, text, int, text, text) to anon, authenticated;

-- ---------------------------------------------------------
-- 運営：記録の一覧（0016 の置き換え。使った機能の数を加える）
-- ---------------------------------------------------------
drop function if exists public.admin_usage_visits(timestamptz);
create or replace function public.admin_usage_visits(p_from timestamptz default null)
returns table (
  id uuid, visitor_id uuid, started_at timestamptz, last_seen_at timestamptz, active_sec int, page_views int,
  first_path text, last_path text, device text, account_email text, account_role text, notifications int, features int
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query
  select v.id, v.visitor_id, v.started_at, v.last_seen_at, v.active_sec, v.page_views,
         v.first_path, v.last_path, v.device, v.account_email, v.account_role,
         case when v.account_email is null then 0
              else (select count(*)::int from public.notification_outbox o where lower(o.recipient) = lower(v.account_email)) end,
         (select count(*)::int from public.usage_events e where e.visit_id = v.id and e.kind = 'feature')
  from public.usage_visits v
  where p_from is null or v.started_at >= p_from
  order by v.started_at desc
  limit 500;
end;
$$;
revoke execute on function public.admin_usage_visits(timestamptz) from public, anon;
grant execute on function public.admin_usage_visits(timestamptz) to authenticated;
