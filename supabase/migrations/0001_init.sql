-- =========================================================
-- 当日・直前予約デモ  データベース定義（Supabase / PostgreSQL）
--
-- 方針
--   ・予約の作成や状態の変更は、すべてデータベースの関数経由で行う
--     （画面側からテーブルへ直接書き込む権限は与えない）
--   ・閲覧権限は行単位のアクセス制御（RLS）でデータベース側に設定する
--   ・同じ枠への同時予約は、行ロックと一意制約の二重で防ぐ
-- =========================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------
-- テーブル
-- ---------------------------------------------------------

-- 利用者のプロフィール（auth.users と1対1）
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  phone        text,
  gender       text check (gender in ('female', 'male')),
  created_at   timestamptz not null default now()
);

create table public.salons (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  address         text not null default '',
  lat             double precision not null,
  lng             double precision not null,
  accepts_genders text[] not null default array['female', 'male'],
  is_approved     boolean not null default false,
  created_at      timestamptz not null default now()
);

-- サロンのスタッフ（ログインユーザーとサロンの紐づけ）
create table public.salon_members (
  salon_id uuid not null references public.salons(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  primary key (salon_id, user_id)
);

-- 美容師（将来の「なりたい髪型から探す」に備え、得意なスタイルを持てる形にしておく）
create table public.stylists (
  id       uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  name     text not null,
  styles   text[] not null default '{}'
);

create table public.menus (
  id           uuid primary key default gen_random_uuid(),
  salon_id     uuid not null references public.salons(id) on delete cascade,
  name         text not null,
  duration_min int  not null check (duration_min between 10 and 300),
  price        int  not null check (price >= 0)
);

-- 空き枠
create table public.slots (
  id         uuid primary key default gen_random_uuid(),
  salon_id   uuid not null references public.salons(id) on delete cascade,
  stylist_id uuid references public.stylists(id) on delete set null,
  menu_id    uuid not null references public.menus(id),
  start_at   timestamptz not null,
  end_at     timestamptz not null,
  price      int  not null check (price >= 0),
  status     text not null default 'open' check (status in ('open', 'booked', 'closed')),
  created_at timestamptz not null default now(),
  constraint slots_time_order check (end_at > start_at),
  -- 受付は9時以降（日本時間）
  constraint slots_business_hours check ((start_at at time zone 'Asia/Tokyo')::time >= time '09:00')
);

-- 同じ美容師の枠が時間帯で重ならないようにする
alter table public.slots
  add constraint slots_no_overlap
  exclude using gist (stylist_id with =, tstzrange(start_at, end_at) with &&)
  where (status <> 'closed' and stylist_id is not null);

create index slots_open_start_idx on public.slots (start_at) where status = 'open';
create index slots_salon_idx on public.slots (salon_id, start_at);

-- 予約（サロンに渡す連絡先は予約時点で写しを持つ。性別・年代はサロンに渡さない）
create table public.bookings (
  id            uuid primary key default gen_random_uuid(),
  slot_id       uuid not null references public.slots(id),
  user_id       uuid references auth.users(id) on delete set null,
  contact_name  text not null,
  contact_phone text,
  note          text,
  status        text not null default 'confirmed'
                check (status in ('confirmed', 'completed', 'no_show', 'cancelled_by_salon')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 1つの枠に有効な予約は1件だけ（行ロックに加えた二重の防止策）
create unique index bookings_one_active_per_slot
  on public.bookings (slot_id) where status <> 'cancelled_by_salon';
create index bookings_user_idx on public.bookings (user_id);

-- 無断キャンセルの記録（電話番号に紐づけ、アカウント削除後も90日間は判定に使う）
create table public.no_show_records (
  id          bigserial primary key,
  phone       text not null,
  booking_id  uuid references public.bookings(id) on delete set null,
  salon_id    uuid references public.salons(id) on delete set null,
  recorded_at timestamptz not null default now()
);
create index no_show_phone_idx on public.no_show_records (phone, recorded_at);

-- 操作記録
create table public.audit_logs (
  id        bigserial primary key,
  actor     uuid,
  action    text not null,
  target_id uuid,
  at        timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 補助関数
-- ---------------------------------------------------------

-- ログイン中のユーザーが、そのサロンのスタッフかどうか
create or replace function public.is_salon_member(p_salon_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.salon_members
    where salon_id = p_salon_id and user_id = auth.uid()
  );
$$;

-- 枠が属するサロン（RLSの中で slots の権限判定を経由しないための関数）
create or replace function public.slot_salon_id(p_slot_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select salon_id from public.slots where id = p_slot_id;
$$;

-- ログイン中のユーザーが、その枠を予約しているかどうか
create or replace function public.has_booking_on_slot(p_slot_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.bookings
    where slot_id = p_slot_id and user_id = auth.uid()
  );
$$;

-- 今日の終わり（日本時間の翌0時）
create or replace function public.jst_today_end()
returns timestamptz
language sql stable
as $$
  select (((now() at time zone 'Asia/Tokyo')::date + 1)::timestamp) at time zone 'Asia/Tokyo';
$$;

-- 新規登録時にプロフィールを作成
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, phone, gender)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', ''),
    new.raw_user_meta_data ->> 'phone',
    case when new.raw_user_meta_data ->> 'gender' in ('female', 'male')
         then new.raw_user_meta_data ->> 'gender' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------
-- 操作用の関数（画面からはこの関数だけを呼ぶ）
-- ---------------------------------------------------------

-- サロン：今日の空き枠を出す
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
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select * into m from public.menus where id = p_menu_id;
  if not found then raise exception 'menu_not_found'; end if;
  if not public.is_salon_member(m.salon_id) then raise exception 'forbidden'; end if;

  if p_stylist_id is not null and not exists (
    select 1 from public.stylists where id = p_stylist_id and salon_id = m.salon_id
  ) then
    raise exception 'stylist_not_found';
  end if;

  if p_start_at < now() + interval '10 minutes' then raise exception 'too_late'; end if;
  if p_start_at >= public.jst_today_end() then raise exception 'today_only'; end if;
  if (p_start_at at time zone 'Asia/Tokyo')::time < time '09:00' then raise exception 'outside_hours'; end if;

  begin
    insert into public.slots (salon_id, stylist_id, menu_id, start_at, end_at, price)
    values (m.salon_id, p_stylist_id, m.id, p_start_at,
            p_start_at + make_interval(mins => m.duration_min), m.price)
    returning * into s;
  exception when exclusion_violation then
    raise exception 'overlap';
  end;

  insert into public.audit_logs (actor, action, target_id) values (auth.uid(), 'create_slot', s.id);
  return s;
end;
$$;

-- サロン：まだ予約されていない枠を取り下げる
create or replace function public.close_slot(p_slot_id uuid)
returns public.slots
language plpgsql security definer set search_path = public
as $$
declare
  s public.slots;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into s from public.slots where id = p_slot_id for update;
  if not found then raise exception 'slot_not_found'; end if;
  if not public.is_salon_member(s.salon_id) then raise exception 'forbidden'; end if;
  if s.status <> 'open' then raise exception 'not_open'; end if;

  update public.slots set status = 'closed' where id = s.id returning * into s;
  insert into public.audit_logs (actor, action, target_id) values (auth.uid(), 'close_slot', s.id);
  return s;
end;
$$;

-- 利用者：予約する
create or replace function public.book_slot(p_slot_id uuid, p_note text default null)
returns public.bookings
language plpgsql security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  p   public.profiles;
  s   public.slots;
  sal public.salons;
  b   public.bookings;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  select * into p from public.profiles where id = uid;
  if not found then raise exception 'profile_missing'; end if;

  -- 直近90日で無断キャンセルが2回あれば予約を受け付けない
  if p.phone is not null and (
    select count(*) from public.no_show_records
    where phone = p.phone and recorded_at > now() - interval '90 days'
  ) >= 2 then
    raise exception 'suspended';
  end if;

  -- 枠を行ロックする。同時に来た2件目は、1件目の確定を待ってから下の判定で弾かれる
  select * into s from public.slots where id = p_slot_id for update;
  if not found then raise exception 'slot_not_found'; end if;
  if s.status <> 'open' then raise exception 'already_booked'; end if;
  if s.start_at < now() + interval '10 minutes' then raise exception 'too_late'; end if;

  select * into sal from public.salons where id = s.salon_id;
  if p.gender is not null and not (p.gender = any (sal.accepts_genders)) then
    raise exception 'not_accepted';
  end if;

  begin
    insert into public.bookings (slot_id, user_id, contact_name, contact_phone, note)
    values (s.id, uid, p.display_name, p.phone, p_note)
    returning * into b;
  exception when unique_violation then
    raise exception 'already_booked';
  end;

  update public.slots set status = 'booked' where id = s.id;
  return b;
end;
$$;

-- サロン：予約の状態を変える（来店済み／無断キャンセル／サロン都合のキャンセル）
create or replace function public.salon_update_booking(p_booking_id uuid, p_action text)
returns public.bookings
language plpgsql security definer set search_path = public
as $$
declare
  b public.bookings;
  s public.slots;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'booking_not_found'; end if;
  select * into s from public.slots where id = b.slot_id for update;
  if not public.is_salon_member(s.salon_id) then raise exception 'forbidden'; end if;
  if b.status <> 'confirmed' then raise exception 'already_closed'; end if;

  if p_action = 'complete' then
    update public.bookings set status = 'completed', updated_at = now()
    where id = b.id returning * into b;

  elsif p_action = 'no_show' then
    -- 予約時刻を過ぎてから記録できる
    if s.start_at > now() then raise exception 'not_started'; end if;
    update public.bookings set status = 'no_show', updated_at = now()
    where id = b.id returning * into b;
    if b.contact_phone is not null then
      insert into public.no_show_records (phone, booking_id, salon_id)
      values (b.contact_phone, b.id, s.salon_id);
    end if;

  elsif p_action = 'cancel' then
    -- サロン都合のキャンセルは無断キャンセルとして記録しない。時間が残っていれば枠を戻す
    update public.bookings set status = 'cancelled_by_salon', updated_at = now()
    where id = b.id returning * into b;
    update public.slots
    set status = case when s.start_at > now() + interval '10 minutes' then 'open' else 'closed' end
    where id = s.id;

  else
    raise exception 'invalid_action';
  end if;

  insert into public.audit_logs (actor, action, target_id)
  values (auth.uid(), 'booking_' || p_action, b.id);
  return b;
end;
$$;

-- ---------------------------------------------------------
-- 行単位のアクセス制御（RLS）
-- ---------------------------------------------------------

alter table public.profiles        enable row level security;
alter table public.salons          enable row level security;
alter table public.salon_members   enable row level security;
alter table public.stylists        enable row level security;
alter table public.menus           enable row level security;
alter table public.slots           enable row level security;
alter table public.bookings        enable row level security;
alter table public.no_show_records enable row level security;
alter table public.audit_logs      enable row level security;

create policy profiles_select_own on public.profiles
  for select using (id = auth.uid());
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy salons_select on public.salons
  for select using (is_approved or public.is_salon_member(id));

create policy salon_members_select_own on public.salon_members
  for select using (user_id = auth.uid());

create policy stylists_select on public.stylists for select using (true);
create policy menus_select    on public.menus    for select using (true);

-- 公開中の枠は誰でも見られる。予約済み・取り下げ済みの枠は、そのサロンと予約した本人だけ
create policy slots_select on public.slots
  for select using (
    status = 'open'
    or public.is_salon_member(salon_id)
    or public.has_booking_on_slot(id)
  );

-- 予約は本人と、その枠のサロンだけが見られる
create policy bookings_select on public.bookings
  for select using (
    user_id = auth.uid()
    or public.is_salon_member(public.slot_salon_id(slot_id))
  );

-- no_show_records と audit_logs にはポリシーを作らない（画面からは一切見えない）

-- ---------------------------------------------------------
-- 権限
-- ---------------------------------------------------------

grant usage on schema public to anon, authenticated;

grant select on public.salons, public.stylists, public.menus, public.slots to anon, authenticated;
grant select on public.profiles, public.salon_members, public.bookings to authenticated;
grant update (display_name) on public.profiles to authenticated;

-- 予約と枠への直接の書き込みは禁止（関数経由のみ）
revoke insert, update, delete on public.slots, public.bookings from anon, authenticated;
revoke all on public.no_show_records, public.audit_logs from anon, authenticated;

revoke execute on function public.create_slot(uuid, timestamptz, uuid)  from public, anon;
revoke execute on function public.close_slot(uuid)                      from public, anon;
revoke execute on function public.book_slot(uuid, text)                 from public, anon;
revoke execute on function public.salon_update_booking(uuid, text)      from public, anon;
grant  execute on function public.create_slot(uuid, timestamptz, uuid)  to authenticated;
grant  execute on function public.close_slot(uuid)                      to authenticated;
grant  execute on function public.book_slot(uuid, text)                 to authenticated;
grant  execute on function public.salon_update_booking(uuid, text)      to authenticated;

-- ---------------------------------------------------------
-- リアルタイム通知（予約が入った瞬間にサロン画面へ反映）
-- ---------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.slots, public.bookings;
  end if;
end;
$$;
