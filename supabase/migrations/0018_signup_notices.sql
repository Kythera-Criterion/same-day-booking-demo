-- =========================================================
-- 0018 新規登録の知らせ：お客様・サロンが新規登録したら、/usage にすぐ届ける
--   ・アカウントが作られたとき（signup）と、確認のリンクを開いて登録が完了したとき（confirmed）に1件ずつ残す
--   ・対象は自分で登録したアカウントだけ（登録の画面・外部 ID で作ったもの。user_metadata に signup_role がある）。
--     運営が招待したアカウント・デモ用のアカウントは数えない
--   ・auth.users のトリガーで残すので、メールアドレス・Google・Yahoo! JAPAN ID のどの登録の方法でも届く
--   ・運営だけが読めて、Realtime で /usage に届く（/usage は知らせの帯と、パソコンへの通知を出す）
-- 0017 のあとに流す。何度流しても同じ結果になる
-- =========================================================

create table if not exists public.signup_notices (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  kind         text not null check (kind in ('signup', 'confirmed')),
  user_id      uuid not null,
  role         text not null check (role in ('user', 'salon')),
  email        text,
  display_name text,
  salon_name   text,
  via          text
);
create index if not exists signup_notices_at_idx on public.signup_notices (at desc);

alter table public.signup_notices enable row level security;
drop policy if exists signup_notices_admin_select on public.signup_notices;
create policy signup_notices_admin_select on public.signup_notices for select using (public.is_admin());
revoke all on public.signup_notices from anon, authenticated;
grant select on public.signup_notices to authenticated;
revoke all on sequence public.signup_notices_id_seq from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, delete on public.signup_notices to service_role;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'signup_notices') then
    alter publication supabase_realtime add table public.signup_notices;
  end if;
end;
$$;

-- アカウントが作られた・メールアドレスの確認が済んだときに、知らせを1件残す
create or replace function public.note_signup()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_role text := meta ->> 'signup_role';
  v_kind text;
begin
  if v_role is null or v_role not in ('user', 'salon') then return new; end if;
  if tg_op = 'INSERT' then
    v_kind := 'signup';
  elsif old.email_confirmed_at is null and new.email_confirmed_at is not null then
    v_kind := 'confirmed';
  else
    return new;
  end if;
  insert into public.signup_notices (kind, user_id, role, email, display_name, salon_name, via)
  values (
    v_kind, new.id, v_role, new.email,
    nullif(left(meta ->> 'display_name', 60), ''),
    nullif(left(meta ->> 'salon_name', 80), ''),
    coalesce(nullif(meta ->> 'signup_via', ''), 'email')
  );
  return new;
end;
$$;
revoke execute on function public.note_signup() from public, anon, authenticated;

drop trigger if exists on_auth_user_signup_notice on auth.users;
create trigger on_auth_user_signup_notice
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.note_signup();
