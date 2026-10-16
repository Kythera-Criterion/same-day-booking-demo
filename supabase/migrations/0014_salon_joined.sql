-- =========================================================
-- 0014 新しいサロンが加わったことを、運営に知らせる
--   承認 → 確認のリンクで登録の完了 → 初期設定（メニュー・担当・お店の場所）を終えて「設定を終えて始める」
--   を押した時点で、そのお店が加わったものとして記録し、運営の画面へ知らせる（初めて終えたときの1回だけ）
--   ・設定を終えるには、メニュー（受付中のもの）が1つ以上と、お店の場所（住所）の登録が必要
--   ・運営の画面は、開いていればその場で、開いていなければ次にログインしたときに知らせる
-- 0001〜0013 のあとに流す。何度流しても同じ結果になる
-- =========================================================

-- お店が初期設定を初めて終えた日時
alter table public.salon_private add column if not exists joined_at timestamptz;

-- すでに設定を終えているお店（デモ用のお店など）は、加わったものとして扱う（知らせない）
update public.salon_private sp
set joined_at = s.created_at
from public.salons s
where s.id = sp.salon_id and sp.onboarding_step = 3 and sp.joined_at is null;

-- ---------------------------------------------------------
-- 運営へのお知らせ（運営だけが読める。画面にすぐ届くよう Realtime で流す）
-- ---------------------------------------------------------
create table if not exists public.admin_notices (
  id         bigserial primary key,
  kind       text not null check (kind in ('salon_joined')),
  salon_id   uuid references public.salons(id) on delete cascade,
  salon_name text not null,
  at         timestamptz not null default now()
);
create index if not exists admin_notices_at_idx on public.admin_notices (at desc);
alter table public.admin_notices enable row level security;
drop policy if exists admin_notices_select on public.admin_notices;
create policy admin_notices_select on public.admin_notices for select using (public.is_admin());
revoke all on public.admin_notices from anon, authenticated;
grant select on public.admin_notices to authenticated;
revoke all on sequence public.admin_notices_id_seq from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, delete on public.admin_notices to service_role;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'admin_notices'
     ) then
    alter publication supabase_realtime add table public.admin_notices;
  end if;
end;
$$;

-- ---------------------------------------------------------
-- 初期設定の進み具合（0005 の置き換え）
--   3（設定を終えて始める）は、メニューとお店の場所がそろっているときだけ。
--   初めて 3 になったときに、加わった日時を残し、運営へのお知らせと操作記録を積む
-- ---------------------------------------------------------
create or replace function public.salon_set_onboarding(p_salon_id uuid, p_step int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_name text;
  v_address text;
  v_joined timestamptz;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_salon_member(p_salon_id) then raise exception 'forbidden'; end if;
  if p_step not between 0 and 3 then raise exception 'invalid_input'; end if;

  select name, address into v_name, v_address from public.salons where id = p_salon_id;
  if p_step = 3 then
    if not exists (select 1 from public.menus where salon_id = p_salon_id and is_active) then
      raise exception 'menu_required';
    end if;
    if coalesce(btrim(v_address), '') = '' then
      raise exception 'address_required';
    end if;
  end if;

  insert into public.salon_private (salon_id, onboarding_step) values (p_salon_id, p_step)
  on conflict (salon_id) do update set onboarding_step = excluded.onboarding_step, updated_at = now();

  if p_step = 3 then
    select joined_at into v_joined from public.salon_private where salon_id = p_salon_id for update;
    -- 初めて設定を終えたときだけ（「初期設定をもう一度表示する」から終え直しても、知らせは増やさない）
    if v_joined is null then
      update public.salon_private set joined_at = now() where salon_id = p_salon_id;
      insert into public.admin_notices (kind, salon_id, salon_name) values ('salon_joined', p_salon_id, v_name);
      insert into public.audit_logs (actor, action, target_id) values (auth.uid(), 'salon_joined', p_salon_id);
    end if;
  end if;
end;
$$;

revoke execute on function public.salon_set_onboarding(uuid, int) from public, anon;
grant execute on function public.salon_set_onboarding(uuid, int) to authenticated;
