-- Supabase の auth / storage スキーマとロールを最小限に再現（ローカル検証用）
-- ロールはクラスタ全体で共有されるため、2回目以降の実行では作り直さない
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end;
$$;

-- Supabase と同じく、public に作った表・関数には既定で権限が付く（マイグレーション側で絞れているかを確かめるため）
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
grant usage on schema public to service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  encrypted_password text,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz
);
grant select on auth.users to service_role;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  owner uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;
grant all on storage.objects, storage.buckets to service_role;
