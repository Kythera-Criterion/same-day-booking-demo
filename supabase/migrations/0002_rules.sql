-- =========================================================
-- 0002 業務ルールの追加（0001 の上に重ねる。何度流しても壊れない書き方にしている）
--
--   ・エリア、運営（admins）、サロンの非公開設定、いつもの枠
--   ・メニューごとの受付締切、枠の「受付終了（expired）」
--   ・お客様連絡によるキャンセル（cancelled_by_customer）
--   ・1アカウント1件（book_slot でプロフィール行もロック）
--   ・予約時点の写し（メール・カルテ・写真・会話の好み）
--   ・ヘア写真（非公開バケット）、アンケート、規約への同意
--   ・掲載希望の受付
-- =========================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------
-- テーブル
-- ---------------------------------------------------------

create table if not exists public.areas (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  lat        double precision not null,
  lng        double precision not null,
  sort_order int  not null default 0
);

create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 利用者のプロフィール（サロンからは読めない。予約時に必要な分だけ写しを作る）
alter table public.profiles add column if not exists email              text;
alter table public.profiles add column if not exists age_group          text;
alter table public.profiles add column if not exists occupation         text;
alter table public.profiles add column if not exists area_id            uuid references public.areas(id) on delete set null;
alter table public.profiles add column if not exists conversation_pref  text;
alter table public.profiles add column if not exists hair_type          text;
alter table public.profiles add column if not exists color_history      text;
alter table public.profiles add column if not exists perm_history       text;
alter table public.profiles add column if not exists adult_confirmed_at timestamptz;
alter table public.profiles add column if not exists updated_at         timestamptz not null default now();

alter table public.profiles drop constraint if exists profiles_age_group_check;
alter table public.profiles add constraint profiles_age_group_check
  check (age_group is null or age_group in ('18-19', '20s', '30s', '40s', '50s', '60+'));
alter table public.profiles drop constraint if exists profiles_conversation_pref_check;
alter table public.profiles add constraint profiles_conversation_pref_check
  check (conversation_pref is null or conversation_pref in ('talk', 'quiet', 'either'));

alter table public.salons add column if not exists area_id uuid references public.areas(id) on delete set null;
alter table public.salons add column if not exists phone   text;

-- サロンの非公開設定（salons は誰でも読めるため、連絡用グループなどは別表に分ける）
create table if not exists public.salon_private (
  salon_id      uuid primary key references public.salons(id) on delete cascade,
  line_group_id text,
  updated_at    timestamptz not null default now()
);

alter table public.stylists add column if not exists is_active boolean not null default true;

-- メニューごとの受付締切（開始の何分前まで予約を受けるか）
alter table public.menus add column if not exists booking_deadline_min int not null default 10;
alter table public.menus add column if not exists is_active boolean not null default true;
alter table public.menus drop constraint if exists menus_deadline_check;
alter table public.menus add constraint menus_deadline_check check (booking_deadline_min between 0 and 600);

-- 枠：受付締切を枠ごとに持つ（枠を出した時点のメニューの締切を写す）。受付終了（expired）を追加
alter table public.slots add column if not exists deadline_at timestamptz;
alter table public.slots add column if not exists demo_history boolean not null default false;
update public.slots set deadline_at = start_at - interval '10 minutes' where deadline_at is null;
alter table public.slots alter column deadline_at set not null;

alter table public.slots drop constraint if exists slots_status_check;
alter table public.slots add constraint slots_status_check
  check (status in ('open', 'booked', 'closed', 'expired'));
alter table public.slots drop constraint if exists slots_deadline_check;
alter table public.slots add constraint slots_deadline_check check (deadline_at <= start_at);

-- 開始は日本時間の 9:00〜23:59（「今日だけ」は関数で確かめる）
alter table public.slots drop constraint if exists slots_business_hours;
alter table public.slots add constraint slots_business_hours
  check ((start_at at time zone 'Asia/Tokyo')::time >= time '09:00') not valid;
do $$
begin
  alter table public.slots validate constraint slots_business_hours;
exception when check_violation then
  raise notice '9時より前の既存の枠があるため、slots_business_hours は新しい行にだけ効かせます';
end;
$$;

-- 同じ美容師の枠が重ならない（公開中・予約済みの枠どうし）
alter table public.slots drop constraint if exists slots_no_overlap;
alter table public.slots
  add constraint slots_no_overlap
  exclude using gist (stylist_id with =, tstzrange(start_at, end_at) with &&)
  where (status in ('open', 'booked') and stylist_id is not null);

drop index if exists public.slots_open_start_idx;
create index slots_open_start_idx on public.slots (deadline_at) where status = 'open';

-- 予約：お客様連絡によるキャンセルを追加し、サロンに渡す範囲の写しを持つ
alter table public.bookings add column if not exists contact_email     text;
alter table public.bookings add column if not exists karte             jsonb;
alter table public.bookings add column if not exists conversation_pref text;
alter table public.bookings add column if not exists photo_path        text;
alter table public.bookings add column if not exists photo_note        text;
alter table public.bookings add column if not exists cancelled_at      timestamptz;
alter table public.bookings add column if not exists completed_at      timestamptz;
alter table public.bookings add column if not exists demo_history      boolean not null default false;

alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings add constraint bookings_status_check
  check (status in ('confirmed', 'completed', 'no_show', 'cancelled_by_salon', 'cancelled_by_customer'));

-- 1つの枠に有効な予約は1件だけ（キャンセルの状態が増えたので作り直す）
drop index if exists public.bookings_one_active_per_slot;
create unique index bookings_one_active_per_slot
  on public.bookings (slot_id) where status not in ('cancelled_by_salon', 'cancelled_by_customer');
create index if not exists bookings_user_status_idx on public.bookings (user_id, status);

-- 運営の集計だけに使う属性（サロンには渡さない。予約時点で写す）
create table if not exists public.booking_demographics (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  age_group  text,
  occupation text
);

-- 無断キャンセル：電話番号は数字だけにそろえて数える
create or replace function public.norm_phone(p text)
returns text
language sql immutable
as $$
  select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '');
$$;
drop index if exists public.no_show_phone_idx;
create index no_show_phone_idx on public.no_show_records (public.norm_phone(phone), recorded_at);

alter table public.audit_logs add column if not exists detail jsonb;

-- 規約・プライバシーポリシーへの同意（版と日時）
create table if not exists public.consents (
  id        bigserial primary key,
  user_id   uuid references auth.users(id) on delete set null,
  kind      text not null check (kind in ('terms', 'privacy')),
  version   text not null,
  agreed_at timestamptz not null default now()
);
create index if not exists consents_user_idx on public.consents (user_id);

-- 予約直後のアンケート（質問はこの表で差し替えられる。回答はサロンに見せない）
create table if not exists public.survey_questions (
  id         text primary key,
  body       text not null,
  choices    text[] not null,
  sort_order int  not null default 0,
  is_active  boolean not null default true
);

create table if not exists public.survey_answers (
  booking_id  uuid not null references public.bookings(id) on delete cascade,
  question_id text not null references public.survey_questions(id),
  answer      text not null,
  answered_at timestamptz not null default now(),
  primary key (booking_id, question_id)
);

-- いつもの枠（メニュー・担当・何分後、の組み合わせ）
create table if not exists public.slot_presets (
  id          uuid primary key default gen_random_uuid(),
  salon_id    uuid not null references public.salons(id) on delete cascade,
  label       text not null,
  menu_id     uuid not null references public.menus(id) on delete cascade,
  stylist_id  uuid references public.stylists(id) on delete set null,
  offsets_min int[] not null default array[30],
  created_at  timestamptz not null default now()
);

-- 掲載希望の受付（公開フォームから）
create table if not exists public.salon_applications (
  id           uuid primary key default gen_random_uuid(),
  salon_name   text not null,
  contact_name text not null,
  email        text not null,
  phone        text,
  area_text    text not null,
  question     text,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  salon_id     uuid references public.salons(id) on delete set null,
  processed_by uuid,
  processed_at timestamptz,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 補助関数
-- ---------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- 今日の始まり（日本時間の0時）
create or replace function public.jst_today_start()
returns timestamptz
language sql stable
as $$
  select ((now() at time zone 'Asia/Tokyo')::date::timestamp) at time zone 'Asia/Tokyo';
$$;

-- 予約停止中なら、予約を再開できる日時を返す（直近90日の記録が1件以下になる時点）
create or replace function public.suspension_until(p_phone text)
returns timestamptz
language sql stable security definer set search_path = public
as $$
  with recent as (
    select recorded_at
    from public.no_show_records
    where public.norm_phone(phone) = public.norm_phone(p_phone)
      and recorded_at > now() - interval '90 days'
    order by recorded_at desc
  )
  select case when count(*) >= 2
              then (array_agg(recorded_at order by recorded_at desc))[2] + interval '90 days'
         end
  from recent
  where public.norm_phone(p_phone) is not null;
$$;

-- ログイン中の利用者の予約停止（再開日時。停止していなければ null）
create or replace function public.my_suspension()
returns timestamptz
language sql stable security definer set search_path = public
as $$
  select public.suspension_until(phone) from public.profiles where id = auth.uid();
$$;

-- そのヘア写真を見てよいか（本人、または写真を共有した予約のサロン）
create or replace function public.can_view_hair_photo(p_name text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null and (
    split_part(p_name, '/', 1) = auth.uid()::text
    or exists (
      select 1
      from public.bookings b
      join public.slots s on s.id = b.slot_id
      where b.photo_path = p_name
        and public.is_salon_member(s.salon_id)
    )
  );
$$;

-- 新規登録時にプロフィールと同意の記録を作る
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_area uuid;
begin
  begin
    v_area := nullif(meta ->> 'area_id', '')::uuid;
  exception when invalid_text_representation then
    v_area := null;
  end;
  if v_area is not null and not exists (select 1 from public.areas where id = v_area) then
    v_area := null;
  end if;

  insert into public.profiles (id, display_name, phone, gender, email, age_group, occupation, area_id,
                               conversation_pref, adult_confirmed_at)
  values (
    new.id,
    left(coalesce(meta ->> 'display_name', ''), 60),
    left(meta ->> 'phone', 20),
    case when meta ->> 'gender' in ('female', 'male') then meta ->> 'gender' end,
    new.email,
    case when meta ->> 'age_group' in ('18-19', '20s', '30s', '40s', '50s', '60+') then meta ->> 'age_group' end,
    left(meta ->> 'occupation', 40),
    v_area,
    case when meta ->> 'conversation_pref' in ('talk', 'quiet', 'either') then meta ->> 'conversation_pref' end,
    case when (meta ->> 'adult_confirmed') = 'true' then now() end
  )
  on conflict (id) do nothing;

  if coalesce(meta ->> 'terms_version', '') <> '' then
    insert into public.consents (user_id, kind, version)
    values (new.id, 'terms', left(meta ->> 'terms_version', 40)),
           (new.id, 'privacy', left(meta ->> 'terms_version', 40));
  end if;
  return new;
end;
$$;

-- 既存のプロフィールにメールアドレスを写す
update public.profiles p set email = u.email
from auth.users u
where u.id = p.id and p.email is null;

-- 枠の受付締切を、メニューの締切から自動で入れる（スクリプトから直接作る場合も同じ扱いにする）
create or replace function public.slots_fill_deadline()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.deadline_at is null then
    select new.start_at - make_interval(mins => m.booking_deadline_min)
    into new.deadline_at
    from public.menus m where m.id = new.menu_id;
  end if;
  return new;
end;
$$;

drop trigger if exists slots_fill_deadline on public.slots;
create trigger slots_fill_deadline
  before insert on public.slots
  for each row execute function public.slots_fill_deadline();

-- ---------------------------------------------------------
-- 利用者の操作
-- ---------------------------------------------------------

-- 今行ける枠を探す（締切・性別・エリアを考慮。現在地は受け取らない）
-- 0006 で戻り値を増やしているため、流し直したときに型が合わなくならないよう、作り直す
drop function if exists public.search_open_slots(timestamptz, uuid);
create or replace function public.search_open_slots(
  p_until   timestamptz,
  p_area_id uuid default null
)
returns table (
  slot_id      uuid,
  start_at     timestamptz,
  end_at       timestamptz,
  deadline_at  timestamptz,
  price        int,
  menu_name    text,
  duration_min int,
  salon_id     uuid,
  salon_name   text,
  salon_address text,
  lat          double precision,
  lng          double precision
)
language sql stable security definer set search_path = public
as $$
  with me as (
    select gender, area_id from public.profiles where id = auth.uid()
  )
  select s.id, s.start_at, s.end_at, s.deadline_at, s.price, m.name, m.duration_min,
         sa.id, sa.name, sa.address, sa.lat, sa.lng
  from public.slots s
  join public.menus  m  on m.id = s.menu_id
  join public.salons sa on sa.id = s.salon_id
  left join me on true
  where s.status = 'open'
    and s.deadline_at > now()
    and s.start_at >= public.jst_today_start()
    and s.start_at <  least(p_until, public.jst_today_end())
    and sa.is_approved
    and (coalesce(p_area_id, me.area_id) is null or sa.area_id = coalesce(p_area_id, me.area_id))
    and (me.gender is null or me.gender = any (sa.accepts_genders))
  order by s.start_at
  limit 100;
$$;

-- 予約する（1タップで確定。写真・メモ・会話の好みは任意）
drop function if exists public.book_slot(uuid, text);
create or replace function public.book_slot(
  p_slot_id           uuid,
  p_note              text default null,
  p_photo_path        text default null,
  p_photo_note        text default null,
  p_conversation_pref text default null
)
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

  -- プロフィール行をロックする。同じ人の予約が同時に来ても、1件ずつ順に判定される
  select * into p from public.profiles where id = uid for update;
  if not found then raise exception 'profile_missing'; end if;
  if p.adult_confirmed_at is null then raise exception 'adult_required'; end if;
  if public.norm_phone(p.phone) is null then raise exception 'phone_required'; end if;

  if public.suspension_until(p.phone) is not null then raise exception 'suspended'; end if;

  -- 同時に持てる予約は1件まで（確定済みで、枠の終了時刻を過ぎていないもの）
  if exists (
    select 1 from public.bookings ob join public.slots os on os.id = ob.slot_id
    where ob.user_id = uid and ob.status = 'confirmed' and os.end_at > now()
  ) then
    raise exception 'has_active_booking';
  end if;

  -- 枠を行ロックする。同時に来た2件目は、1件目の確定を待ってから下の判定で弾かれる
  select * into s from public.slots where id = p_slot_id for update;
  if not found then raise exception 'slot_not_found'; end if;
  if s.status <> 'open' then
    if s.status = 'expired' then raise exception 'too_late'; end if;
    raise exception 'already_booked';
  end if;
  if s.deadline_at <= now() then raise exception 'too_late'; end if;
  if s.start_at >= public.jst_today_end() then raise exception 'today_only'; end if;

  select * into sal from public.salons where id = s.salon_id;
  if not sal.is_approved then raise exception 'slot_not_found'; end if;
  if p.gender is not null and not (p.gender = any (sal.accepts_genders)) then
    raise exception 'not_accepted';
  end if;

  if p_photo_path is not null and split_part(p_photo_path, '/', 1) <> uid::text then
    raise exception 'invalid_photo';
  end if;
  if p_conversation_pref is not null and p_conversation_pref not in ('talk', 'quiet', 'either') then
    raise exception 'invalid_input';
  end if;

  begin
    insert into public.bookings (slot_id, user_id, contact_name, contact_phone, contact_email, note,
                                 karte, conversation_pref, photo_path, photo_note)
    values (
      s.id, uid, p.display_name, p.phone, p.email, left(p_note, 200),
      jsonb_strip_nulls(jsonb_build_object(
        'hair_type', p.hair_type, 'color_history', p.color_history, 'perm_history', p.perm_history)),
      coalesce(p_conversation_pref, p.conversation_pref),
      p_photo_path,
      case when p_photo_path is not null then left(p_photo_note, 200) end
    )
    returning * into b;
  exception when unique_violation then
    raise exception 'already_booked';
  end;

  insert into public.booking_demographics (booking_id, age_group, occupation)
  values (b.id, p.age_group, p.occupation);

  update public.slots set status = 'booked' where id = s.id;
  return b;
end;
$$;

-- 予約直後のアンケートに答える（任意。本人の予約だけ）
create or replace function public.submit_survey(p_booking_id uuid, p_answers jsonb)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  k text;
  v text;
  n int := 0;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.bookings where id = p_booking_id and user_id = auth.uid()) then
    raise exception 'forbidden';
  end if;
  if jsonb_typeof(p_answers) <> 'object' then raise exception 'invalid_input'; end if;

  for k, v in select key, value from jsonb_each_text(p_answers) loop
    if not exists (
      select 1 from public.survey_questions q where q.id = k and q.is_active and v = any (q.choices)
    ) then
      raise exception 'invalid_input';
    end if;
    insert into public.survey_answers (booking_id, question_id, answer)
    values (p_booking_id, k, v)
    on conflict (booking_id, question_id) do update set answer = excluded.answer, answered_at = now();
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- プロフィール・カルテ・会話の好みを更新する
create or replace function public.update_my_profile(
  p_display_name      text,
  p_phone             text,
  p_gender            text,
  p_age_group         text,
  p_occupation        text,
  p_area_id           uuid,
  p_conversation_pref text,
  p_hair_type         text,
  p_color_history     text,
  p_perm_history      text
)
returns public.profiles
language plpgsql security definer set search_path = public
as $$
declare
  p public.profiles;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into p from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'profile_missing'; end if;

  -- 予約停止中は電話番号を変えられない（判定は電話番号で行うため）
  if public.norm_phone(p_phone) is distinct from public.norm_phone(p.phone)
     and public.suspension_until(p.phone) is not null then
    raise exception 'suspended';
  end if;
  if coalesce(btrim(p_display_name), '') = '' then raise exception 'invalid_input'; end if;

  update public.profiles set
    display_name      = left(btrim(p_display_name), 60),
    phone             = left(p_phone, 20),
    gender            = case when p_gender in ('female', 'male') then p_gender end,
    age_group         = p_age_group,
    occupation        = left(p_occupation, 40),
    area_id           = p_area_id,
    conversation_pref = p_conversation_pref,
    hair_type         = left(p_hair_type, 200),
    color_history     = left(p_color_history, 200),
    perm_history      = left(p_perm_history, 200),
    updated_at        = now()
  where id = auth.uid()
  returning * into p;
  return p;
end;
$$;

-- 18歳以上の確認と規約への同意（登録後に改めて同意する場合）
create or replace function public.confirm_terms(p_version text, p_adult boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not p_adult then raise exception 'adult_required'; end if;
  if coalesce(p_version, '') = '' then raise exception 'invalid_input'; end if;
  update public.profiles set adult_confirmed_at = coalesce(adult_confirmed_at, now())
  where id = auth.uid();
  insert into public.consents (user_id, kind, version)
  values (auth.uid(), 'terms', left(p_version, 40)), (auth.uid(), 'privacy', left(p_version, 40));
end;
$$;

-- 掲載希望を送る（ログイン不要）
create or replace function public.submit_salon_application(
  p_salon_name   text,
  p_contact_name text,
  p_email        text,
  p_phone        text,
  p_area_text    text,
  p_question     text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if coalesce(btrim(p_salon_name), '') = '' or coalesce(btrim(p_contact_name), '') = ''
     or coalesce(btrim(p_area_text), '') = '' or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_input';
  end if;
  insert into public.salon_applications (salon_name, contact_name, email, phone, area_text, question)
  values (left(btrim(p_salon_name), 80), left(btrim(p_contact_name), 60), left(btrim(p_email), 120),
          nullif(left(btrim(coalesce(p_phone, '')), 20), ''), left(btrim(p_area_text), 80),
          nullif(left(btrim(coalesce(p_question, '')), 1000), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------
-- サロンの操作
-- ---------------------------------------------------------

-- 今日の空き枠を出す（受付締切より前に予約を受けられる時刻だけ）
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

-- 予約の状態を変える
--   complete        来店済み
--   no_show         無断キャンセル（予約時刻を過ぎてから）
--   cancel_customer お客様から連絡があったキャンセル
--   cancel_salon    サロン都合のキャンセル（cancel は互換のための別名）
-- キャンセルはどちらも無断キャンセルとして記録せず、締切まで時間が残っていれば枠を公開に戻す
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
    update public.slots
    set status = case when s.deadline_at > now() then 'open' else 'closed' end
    where id = s.id;

  else
    raise exception 'invalid_action';
  end if;

  insert into public.audit_logs (actor, action, target_id)
  values (auth.uid(), 'booking_' || v_action, b.id);
  return b;
end;
$$;

-- メニューを追加・変更する（p_id が null なら追加）
create or replace function public.salon_upsert_menu(
  p_salon_id     uuid,
  p_id           uuid,
  p_name         text,
  p_duration_min int,
  p_price        int,
  p_deadline_min int,
  p_is_active    boolean default true
)
returns public.menus
language plpgsql security definer set search_path = public
as $$
declare
  m public.menus;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_salon_member(p_salon_id) then raise exception 'forbidden'; end if;
  if coalesce(btrim(p_name), '') = '' or p_duration_min not between 10 and 300
     or p_price < 0 or p_deadline_min not between 0 and 600 then
    raise exception 'invalid_input';
  end if;

  if p_id is null then
    insert into public.menus (salon_id, name, duration_min, price, booking_deadline_min, is_active)
    values (p_salon_id, left(btrim(p_name), 60), p_duration_min, p_price, p_deadline_min, coalesce(p_is_active, true))
    returning * into m;
  else
    update public.menus set name = left(btrim(p_name), 60), duration_min = p_duration_min, price = p_price,
                            booking_deadline_min = p_deadline_min, is_active = coalesce(p_is_active, true)
    where id = p_id and salon_id = p_salon_id
    returning * into m;
    if not found then raise exception 'menu_not_found'; end if;
  end if;

  insert into public.audit_logs (actor, action, target_id, detail)
  values (auth.uid(), 'upsert_menu', m.id, to_jsonb(m));
  return m;
end;
$$;

-- 美容師を追加・変更する（p_id が null なら追加）
create or replace function public.salon_upsert_stylist(
  p_salon_id  uuid,
  p_id        uuid,
  p_name      text,
  p_is_active boolean default true
)
returns public.stylists
language plpgsql security definer set search_path = public
as $$
declare
  st public.stylists;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_salon_member(p_salon_id) then raise exception 'forbidden'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'invalid_input'; end if;

  if p_id is null then
    insert into public.stylists (salon_id, name, is_active)
    values (p_salon_id, left(btrim(p_name), 40), coalesce(p_is_active, true))
    returning * into st;
  else
    update public.stylists set name = left(btrim(p_name), 40), is_active = coalesce(p_is_active, true)
    where id = p_id and salon_id = p_salon_id
    returning * into st;
    if not found then raise exception 'stylist_not_found'; end if;
  end if;

  insert into public.audit_logs (actor, action, target_id) values (auth.uid(), 'upsert_stylist', st.id);
  return st;
end;
$$;

-- 受け付ける性別・電話番号・LINE の連絡用グループ
create or replace function public.salon_update_settings(
  p_salon_id        uuid,
  p_accepts_genders text[],
  p_phone           text,
  p_line_group_id   text
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_salon_member(p_salon_id) then raise exception 'forbidden'; end if;
  if p_accepts_genders is null or cardinality(p_accepts_genders) = 0
     or not (p_accepts_genders <@ array['female', 'male']) then
    raise exception 'invalid_input';
  end if;

  update public.salons set accepts_genders = p_accepts_genders, phone = nullif(left(btrim(coalesce(p_phone, '')), 20), '')
  where id = p_salon_id;
  insert into public.salon_private (salon_id, line_group_id, updated_at)
  values (p_salon_id, nullif(left(btrim(coalesce(p_line_group_id, '')), 80), ''), now())
  on conflict (salon_id) do update set line_group_id = excluded.line_group_id, updated_at = now();

  insert into public.audit_logs (actor, action, target_id, detail)
  values (auth.uid(), 'update_salon_settings', p_salon_id,
          jsonb_build_object('accepts_genders', p_accepts_genders));
end;
$$;

-- いつもの枠を保存・削除する
create or replace function public.salon_save_preset(
  p_salon_id    uuid,
  p_label       text,
  p_menu_id     uuid,
  p_stylist_id  uuid,
  p_offsets_min int[]
)
returns public.slot_presets
language plpgsql security definer set search_path = public
as $$
declare
  r public.slot_presets;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_salon_member(p_salon_id) then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.menus where id = p_menu_id and salon_id = p_salon_id) then
    raise exception 'menu_not_found';
  end if;
  if p_stylist_id is not null and not exists (select 1 from public.stylists where id = p_stylist_id and salon_id = p_salon_id) then
    raise exception 'stylist_not_found';
  end if;
  if coalesce(btrim(p_label), '') = '' or p_offsets_min is null or cardinality(p_offsets_min) not between 1 and 8 then
    raise exception 'invalid_input';
  end if;
  insert into public.slot_presets (salon_id, label, menu_id, stylist_id, offsets_min)
  values (p_salon_id, left(btrim(p_label), 40), p_menu_id, p_stylist_id, p_offsets_min)
  returning * into r;
  return r;
end;
$$;

create or replace function public.salon_delete_preset(p_preset_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_salon uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select salon_id into v_salon from public.slot_presets where id = p_preset_id;
  if v_salon is null or not public.is_salon_member(v_salon) then raise exception 'forbidden'; end if;
  delete from public.slot_presets where id = p_preset_id;
end;
$$;

-- ---------------------------------------------------------
-- 運営の操作
-- ---------------------------------------------------------

-- 掲載希望を承認する。スタッフのアカウントはサーバー側で作ってから、その ID を渡す
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

  -- 位置は仮に、最初のエリアの基準地点にしておく（掲載前にサロンが設定する）
  select * into v_area from public.areas order by sort_order limit 1;
  insert into public.salons (name, address, lat, lng, area_id, is_approved, phone)
  values (a.salon_name, '', coalesce(v_area.lat, 0), coalesce(v_area.lng, 0), v_area.id, true, a.phone)
  returning id into v_salon;
  if p_staff_user_id is not null then
    insert into public.salon_members (salon_id, user_id) values (v_salon, p_staff_user_id)
    on conflict do nothing;
  end if;

  update public.salon_applications
  set status = 'approved', salon_id = v_salon, processed_by = auth.uid(), processed_at = now()
  where id = a.id;
  insert into public.audit_logs (actor, action, target_id) values (auth.uid(), 'approve_application', a.id);
  return v_salon;
end;
$$;

create or replace function public.admin_reject_application(p_application_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.salon_applications
  set status = 'rejected', processed_by = auth.uid(), processed_at = now()
  where id = p_application_id and status = 'pending';
  if not found then raise exception 'already_closed'; end if;
  insert into public.audit_logs (actor, action, target_id) values (auth.uid(), 'reject_application', p_application_id);
end;
$$;

-- 予約停止中の電話番号（一部を伏せて表示）
create or replace function public.admin_suspended_phones()
returns table (masked_phone text, records int, resume_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query
  select left(np, 3) || repeat('*', greatest(length(np) - 7, 0)) || right(np, 4),
         cnt::int,
         public.suspension_until(np)
  from (
    select public.norm_phone(phone) as np, count(*) as cnt
    from public.no_show_records
    where recorded_at > now() - interval '90 days'
    group by 1
  ) t
  where cnt >= 2
  order by 3;
end;
$$;

-- ---------------------------------------------------------
-- 行単位のアクセス制御（RLS）
-- ---------------------------------------------------------

alter table public.areas                enable row level security;
alter table public.admins               enable row level security;
alter table public.salon_private        enable row level security;
alter table public.booking_demographics enable row level security;
alter table public.consents             enable row level security;
alter table public.survey_questions     enable row level security;
alter table public.survey_answers       enable row level security;
alter table public.slot_presets         enable row level security;
alter table public.salon_applications   enable row level security;

drop policy if exists areas_select on public.areas;
create policy areas_select on public.areas for select using (true);

drop policy if exists admins_select_own on public.admins;
create policy admins_select_own on public.admins for select using (user_id = auth.uid());

drop policy if exists salon_private_select on public.salon_private;
create policy salon_private_select on public.salon_private
  for select using (public.is_salon_member(salon_id) or public.is_admin());

drop policy if exists survey_questions_select on public.survey_questions;
create policy survey_questions_select on public.survey_questions for select using (is_active);

drop policy if exists slot_presets_select on public.slot_presets;
create policy slot_presets_select on public.slot_presets
  for select using (public.is_salon_member(salon_id));

drop policy if exists salon_applications_select on public.salon_applications;
create policy salon_applications_select on public.salon_applications
  for select using (public.is_admin());

-- 運営は全体を見られる（サロン・枠・予約・スタッフの紐づけ・操作記録）
drop policy if exists salons_select on public.salons;
create policy salons_select on public.salons
  for select using (is_approved or public.is_salon_member(id) or public.is_admin());

drop policy if exists salon_members_select_own on public.salon_members;
create policy salon_members_select_own on public.salon_members
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists slots_select on public.slots;
create policy slots_select on public.slots
  for select using (
    status = 'open'
    or public.is_salon_member(salon_id)
    or public.has_booking_on_slot(id)
    or public.is_admin()
  );

drop policy if exists bookings_select on public.bookings;
create policy bookings_select on public.bookings
  for select using (
    user_id = auth.uid()
    or public.is_salon_member(public.slot_salon_id(slot_id))
    or public.is_admin()
  );

drop policy if exists audit_logs_admin_select on public.audit_logs;
create policy audit_logs_admin_select on public.audit_logs for select using (public.is_admin());

-- booking_demographics・consents・survey_answers・no_show_records にはポリシーを作らない
-- （画面からは見えない。運営は集計の関数だけを通して数字を見る）

-- ---------------------------------------------------------
-- 権限（Supabase は新しい表・関数に既定で権限を付けるため、明示的に絞る）
-- ---------------------------------------------------------

revoke all on public.areas, public.admins, public.salon_private, public.booking_demographics,
              public.consents, public.survey_questions, public.survey_answers, public.slot_presets,
              public.salon_applications
  from anon, authenticated;

grant select on public.areas, public.survey_questions to anon, authenticated;
grant select on public.admins, public.salon_private, public.slot_presets, public.salon_applications,
                public.audit_logs to authenticated;

-- 個人に関わる表は、ログインしていない人には権限ごと渡さない（RLS に加えた二重の防止）
revoke all on public.profiles, public.bookings, public.salon_members, public.no_show_records, public.audit_logs
  from anon;

-- プロフィールの書き換えも関数経由だけにする
revoke insert, update, delete on public.profiles from anon, authenticated;
revoke insert, update, delete on public.salons, public.menus, public.stylists, public.salon_members
  from anon, authenticated;

do $$
declare
  f text;
begin
  -- 利用者・サロン・運営が呼ぶ関数（ログインが必要。中で本人・所属・権限を確かめる）
  foreach f in array array[
    'public.create_slot(uuid, timestamptz, uuid)',
    'public.close_slot(uuid)',
    'public.book_slot(uuid, text, text, text, text)',
    'public.salon_update_booking(uuid, text)',
    'public.submit_survey(uuid, jsonb)',
    'public.update_my_profile(text, text, text, text, text, uuid, text, text, text, text)',
    'public.confirm_terms(text, boolean)',
    'public.my_suspension()',
    'public.salon_upsert_menu(uuid, uuid, text, int, int, int, boolean)',
    'public.salon_upsert_stylist(uuid, uuid, text, boolean)',
    'public.salon_update_settings(uuid, text[], text, text)',
    'public.salon_save_preset(uuid, text, uuid, uuid, int[])',
    'public.salon_delete_preset(uuid)',
    'public.admin_approve_application(uuid, uuid)',
    'public.admin_reject_application(uuid)',
    'public.admin_suspended_phones()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;

  -- ログインしていなくても呼べる関数
  foreach f in array array[
    'public.search_open_slots(timestamptz, uuid)',
    'public.submit_salon_application(text, text, text, text, text, text)',
    'public.is_admin()',
    'public.is_salon_member(uuid)',
    'public.has_booking_on_slot(uuid)',
    'public.slot_salon_id(uuid)',
    'public.can_view_hair_photo(text)',
    'public.jst_today_start()',
    'public.jst_today_end()',
    'public.norm_phone(text)'
  ] loop
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;

  -- 画面から直接呼ばせない関数
  foreach f in array array[
    'public.suspension_until(text)',
    'public.handle_new_user()',
    'public.slots_fill_deadline()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------
-- ヘア写真（非公開バケット。本人と、共有した予約のサロンだけが見られる）
-- ---------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage スキーマがないため、ヘア写真のバケットは作りません';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('hair-photos', 'hair-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                                 allowed_mime_types = excluded.allowed_mime_types;

  execute 'drop policy if exists hair_photos_insert_own on storage.objects';
  execute $p$create policy hair_photos_insert_own on storage.objects for insert to authenticated
            with check (bucket_id = 'hair-photos' and split_part(name, '/', 1) = auth.uid()::text)$p$;
  execute 'drop policy if exists hair_photos_select on storage.objects';
  execute $p$create policy hair_photos_select on storage.objects for select to authenticated
            using (bucket_id = 'hair-photos' and public.can_view_hair_photo(name))$p$;
  execute 'drop policy if exists hair_photos_delete_own on storage.objects';
  execute $p$create policy hair_photos_delete_own on storage.objects for delete to authenticated
            using (bucket_id = 'hair-photos' and split_part(name, '/', 1) = auth.uid()::text)$p$;
exception when insufficient_privilege then
  raise notice 'storage.objects のポリシーを作る権限がありません。README の手順で設定してください';
end;
$$;

-- ---------------------------------------------------------
-- リアルタイム配信
-- ---------------------------------------------------------
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then return; end if;
  foreach t in array array['slots', 'bookings', 'salon_applications'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
