-- =========================================================
-- 0009 新規登録（0008 のあとに流す。何度流しても壊れない書き方にしている）
--
--   ・Google・Yahoo! JAPAN ID などでの登録・ログイン（外部の ID とアカウントの紐づけ）
--   ・サロンの自己登録（アカウントを作って店舗の情報を出す → 審査中 → 運営が承認）
--   ・審査中・掲載停止中のサロンは枠を出せない
--   ・運営メンバーの一覧・招待・外す（運営の登録は、既存の運営からの招待だけ）
--   ・承認・見送り・運営への招待のメール
-- =========================================================

-- ---------------------------------------------------------
-- 外部の ID（Google・Yahoo! JAPAN など）とアカウントの紐づけ。サーバー側だけが読み書きする
-- ---------------------------------------------------------
create table if not exists public.social_identities (
  provider   text not null,
  subject    text not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  primary key (provider, subject)
);
create index if not exists social_identities_user_idx on public.social_identities (user_id);
alter table public.social_identities enable row level security;
revoke all on public.social_identities from anon, authenticated;

-- メールアドレスからアカウントを探す（サーバー側の登録・外部 ID ログインだけが使う）
create or replace function public.find_user_id_by_email(p_email text)
returns uuid
language sql stable security definer set search_path = public, auth
as $$
  select id from auth.users where lower(email) = lower(btrim(p_email)) limit 1;
$$;

-- 外部 ID で作ったアカウントは、本人の知らない仮のパスワードが入る。その時点の値を控えておき、
-- 本人がパスワードを決めた（値が変わった）かどうかで「パスワードでもログインできるか」を判定する
create table if not exists public.passwordless_accounts (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  pw_hash    text,
  created_at timestamptz not null default now()
);
alter table public.passwordless_accounts enable row level security;
revoke all on public.passwordless_accounts from anon, authenticated;

create or replace function public.mark_passwordless(p_user_id uuid)
returns void
language sql security definer set search_path = public, auth
as $$
  insert into public.passwordless_accounts (user_id, pw_hash)
  select id, encrypted_password from auth.users where id = p_user_id
  on conflict (user_id) do update set pw_hash = excluded.pw_hash, created_at = now();
$$;

-- そのアカウントに、本人が決めたパスワードがあるか（外部 ID の連携を外してよいかの判定に使う）
create or replace function public.user_has_password(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = public, auth
as $$
  select coalesce((
    select u.encrypted_password is not null and u.encrypted_password <> ''
           and u.encrypted_password is distinct from (select p.pw_hash from public.passwordless_accounts p where p.user_id = u.id)
    from auth.users u where u.id = p_user_id
  ), false);
$$;

revoke execute on function public.find_user_id_by_email(text) from public, anon, authenticated;
revoke execute on function public.user_has_password(uuid) from public, anon, authenticated;
revoke execute on function public.mark_passwordless(uuid) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.find_user_id_by_email(text) to service_role;
    grant execute on function public.user_has_password(uuid) to service_role;
    grant execute on function public.mark_passwordless(uuid) to service_role;
    grant select, insert, update, delete on public.social_identities to service_role;
  end if;
end;
$$;

-- ---------------------------------------------------------
-- メールの種類を増やす（登録の確認・登録済みのお知らせ・承認のお知らせ・見送りのお知らせ・運営への招待）
-- ---------------------------------------------------------
alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check
  check (kind in ('booking_created', 'booking_cancelled', 'salon_cancel_mail', 'salon_welcome_mail',
                  'signup_confirm_mail', 'account_exists_mail',
                  'salon_approved_mail', 'salon_rejected_mail', 'admin_invite_mail'));

-- ---------------------------------------------------------
-- サロンの自己登録
-- ---------------------------------------------------------
alter table public.salon_applications add column if not exists applicant_user_id uuid references auth.users(id) on delete set null;

-- ログイン中のアカウントで、店舗の情報を出す。サロンは「審査中」（掲載されない）で作られ、
-- 掲載希望として運営に届く。審査の間も、メニューや担当などの準備はできる
create or replace function public.salon_self_register(
  p_salon_name   text,
  p_contact_name text,
  p_phone        text,
  p_area_id      uuid,
  p_address      text,
  p_question     text default null
)
returns uuid
language plpgsql security definer set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
  v_email text;
  v_area public.areas;
  v_salon uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.salon_members where user_id = uid) then raise exception 'already_registered'; end if;
  if coalesce(btrim(p_salon_name), '') = '' or coalesce(btrim(p_contact_name), '') = ''
     or coalesce(btrim(p_address), '') = '' or public.norm_phone(p_phone) is null then
    raise exception 'invalid_input';
  end if;
  select * into v_area from public.areas where id = p_area_id;
  if not found then raise exception 'invalid_input'; end if;
  select email into v_email from auth.users where id = uid;

  -- 位置は仮にエリアの基準地点にしておく（承認の前後に、サロンが「お店の情報と場所」で直す）
  insert into public.salons (name, address, lat, lng, area_id, is_approved, phone)
  values (left(btrim(p_salon_name), 80), left(btrim(p_address), 120), v_area.lat, v_area.lng, v_area.id, false,
          nullif(left(btrim(p_phone), 20), ''))
  returning id into v_salon;
  insert into public.salon_members (salon_id, user_id) values (v_salon, uid);
  insert into public.salon_private (salon_id, onboarding_step) values (v_salon, 0)
  on conflict (salon_id) do nothing;
  insert into public.salon_applications (salon_name, contact_name, email, phone, area_text, question, salon_id, applicant_user_id)
  values (left(btrim(p_salon_name), 80), left(btrim(p_contact_name), 60), coalesce(v_email, ''),
          nullif(left(btrim(p_phone), 20), ''), v_area.name, nullif(left(btrim(coalesce(p_question, '')), 1000), ''),
          v_salon, uid);
  insert into public.audit_logs (actor, action, target_id) values (uid, 'salon_self_register', v_salon);
  return v_salon;
end;
$$;

-- サロンのスタッフが、自店の掲載の状態を知る（listed：掲載中／reviewing：審査中／rejected：見送り／suspended：掲載停止中）
create or replace function public.my_salon_status(p_salon_id uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  s public.salons;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_salon_member(p_salon_id) then raise exception 'forbidden'; end if;
  select * into s from public.salons where id = p_salon_id;
  if s.is_approved then return 'listed'; end if;
  if exists (select 1 from public.salon_applications where salon_id = p_salon_id and status = 'pending') then return 'reviewing'; end if;
  if exists (select 1 from public.salon_applications where salon_id = p_salon_id and status = 'rejected')
     and not exists (select 1 from public.salon_applications where salon_id = p_salon_id and status = 'approved') then
    return 'rejected';
  end if;
  return 'suspended';
end;
$$;

-- 掲載希望の承認：自己登録（サロンがすでにある）なら掲載を始め、
-- フォームからの申込なら、これまでどおりサロンを作ってスタッフを紐づける
create or replace function public.admin_approve_application(p_application_id uuid, p_staff_user_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  a public.salon_applications;
  v_salon uuid;
  v_area public.areas;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select * into a from public.salon_applications where id = p_application_id for update;
  if not found then raise exception 'not_found'; end if;
  if a.status <> 'pending' then raise exception 'already_closed'; end if;

  if a.salon_id is not null then
    update public.salons set is_approved = true where id = a.salon_id;
    v_salon := a.salon_id;
  else
    select * into v_area from public.areas order by sort_order limit 1;
    insert into public.salons (name, address, lat, lng, area_id, is_approved, phone)
    values (a.salon_name, '', coalesce(v_area.lat, 0), coalesce(v_area.lng, 0), v_area.id, true, a.phone)
    returning id into v_salon;
    if p_staff_user_id is not null then
      insert into public.salon_members (salon_id, user_id) values (v_salon, p_staff_user_id)
      on conflict do nothing;
    end if;
  end if;

  update public.salon_applications
  set status = 'approved', salon_id = v_salon, processed_by = auth.uid(), processed_at = now()
  where id = a.id;
  insert into public.audit_logs (actor, action, target_id) values (auth.uid(), 'approve_application', a.id);
  return v_salon;
end;
$$;

-- ---------------------------------------------------------
-- 枠を出す（0002 の内容に、審査中・掲載停止中のサロンは枠を出せない判定を加えたもの）
-- ---------------------------------------------------------
create or replace function public.create_slot(
  p_menu_id    uuid,
  p_start_at   timestamptz,
  p_stylist_id uuid default null
)
returns public.slots
language plpgsql security definer set search_path = public
as $$
declare
  m public.menus;
  s public.slots;
  v_deadline timestamptz;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select * into m from public.menus where id = p_menu_id;
  if not found or not m.is_active then raise exception 'menu_not_found'; end if;
  if not public.is_salon_member(m.salon_id) then raise exception 'forbidden'; end if;
  if not public.salon_is_listed(m.salon_id) then raise exception 'salon_not_listed'; end if;

  if p_stylist_id is not null and not exists (
    select 1 from public.stylists where id = p_stylist_id and salon_id = m.salon_id and is_active
  ) then
    raise exception 'stylist_not_found';
  end if;

  v_deadline := p_start_at - make_interval(mins => m.booking_deadline_min);
  if p_start_at >= public.jst_today_end() or p_start_at < public.jst_today_start() then
    raise exception 'today_only';
  end if;
  if v_deadline <= now() then raise exception 'too_late'; end if;
  if (p_start_at at time zone 'Asia/Tokyo')::time < time '09:00' then raise exception 'outside_hours'; end if;

  begin
    insert into public.slots (salon_id, stylist_id, menu_id, start_at, end_at, price, deadline_at)
    values (m.salon_id, p_stylist_id, m.id, p_start_at,
            p_start_at + make_interval(mins => m.duration_min), m.price, v_deadline)
    returning * into s;
  exception when exclusion_violation then
    raise exception 'overlap';
  end;

  insert into public.audit_logs (actor, action, target_id) values (auth.uid(), 'create_slot', s.id);
  return s;
end;
$$;

-- ---------------------------------------------------------
-- 運営メンバー（運営の登録は、既存の運営からの招待だけ。招待はサーバー側の処理で行う）
-- ---------------------------------------------------------
alter table public.admins add column if not exists invited_by uuid;

create or replace function public.admin_list_admins()
returns table (user_id uuid, email text, display_name text, created_at timestamptz, last_sign_in_at timestamptz, is_me boolean)
language plpgsql stable security definer set search_path = public, auth
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query
  select a.user_id, u.email::text, coalesce(p.display_name, ''), a.created_at, u.last_sign_in_at, a.user_id = auth.uid()
  from public.admins a
  join auth.users u on u.id = a.user_id
  left join public.profiles p on p.id = a.user_id
  order by a.created_at;
end;
$$;

create or replace function public.admin_remove_admin(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_user_id = auth.uid() then raise exception 'cannot_remove_self'; end if;
  if (select count(*) from public.admins) <= 1 then raise exception 'last_admin'; end if;
  delete from public.admins where user_id = p_user_id;
  if not found then raise exception 'not_found'; end if;
  insert into public.audit_logs (actor, action, target_id) values (auth.uid(), 'remove_admin', p_user_id);
end;
$$;

-- ---------------------------------------------------------
-- 権限
-- ---------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.salon_self_register(text, text, text, uuid, text, text)',
    'public.my_salon_status(uuid)',
    'public.admin_approve_application(uuid, uuid)',
    'public.create_slot(uuid, timestamptz, uuid)',
    'public.admin_list_admins()',
    'public.admin_remove_admin(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
