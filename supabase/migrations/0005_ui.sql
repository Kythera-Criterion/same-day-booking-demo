-- =========================================================
-- 0005 画面の仕上げに必要な追加（0004 のあとに流す。何度流しても壊れない書き方にしている）
--
--   ・予約番号（その日そのサロンで重ならない番号。受付で伝える）
--   ・「今日はここまで」：公開中の枠をまとめて取り下げ、締切前のものだけ元に戻せる
--   ・空いた時間を切り分けた複数の枠を、まとめて作る（作れなかった分は理由を返す）
--   ・いつもの空き方（空いた時間の長さ・メニュー・担当）
--   ・サロンの初期設定の進み具合（途中でやめても続きから）
-- =========================================================

-- ---------------------------------------------------------
-- 予約番号
-- ---------------------------------------------------------
alter table public.bookings add column if not exists booking_no int;

-- サロン・日ごとの番号の払い出し（行ロックで、同時の予約にも重ならない番号を振る）
create table if not exists public.booking_counters (
  salon_id uuid not null references public.salons(id) on delete cascade,
  day      date not null,
  last_no  int  not null default 0,
  primary key (salon_id, day)
);
alter table public.booking_counters enable row level security;
revoke all on public.booking_counters from anon, authenticated;

create or replace function public.next_booking_no(p_salon_id uuid, p_at timestamptz)
returns int
language sql security definer set search_path = public
as $$
  insert into public.booking_counters as c (salon_id, day, last_no)
  values (p_salon_id, (p_at at time zone 'Asia/Tokyo')::date, 1)
  on conflict (salon_id, day) do update set last_no = c.last_no + 1
  returning last_no;
$$;

-- 予約する（0002 の内容に、予約番号の払い出しを加えたもの）
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
                                 karte, conversation_pref, photo_path, photo_note, booking_no)
    values (
      s.id, uid, p.display_name, p.phone, p.email, left(p_note, 200),
      jsonb_strip_nulls(jsonb_build_object(
        'hair_type', p.hair_type, 'color_history', p.color_history, 'perm_history', p.perm_history)),
      coalesce(p_conversation_pref, p.conversation_pref),
      p_photo_path,
      case when p_photo_path is not null then left(p_photo_note, 200) end,
      public.next_booking_no(s.salon_id, s.start_at)
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

-- ---------------------------------------------------------
-- 「今日はここまで」と「元に戻す」
-- ---------------------------------------------------------
alter table public.slots add column if not exists closed_reason text;
alter table public.slots add column if not exists closed_at timestamptz;
alter table public.slots drop constraint if exists slots_closed_reason_check;
alter table public.slots add constraint slots_closed_reason_check
  check (closed_reason is null or closed_reason in ('withdrawn', 'paused'));

-- 1枠の取り下げ（理由を残すようにした）
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

  update public.slots set status = 'closed', closed_reason = 'withdrawn', closed_at = now()
  where id = s.id returning * into s;
  insert into public.audit_logs (actor, action, target_id) values (auth.uid(), 'close_slot', s.id);
  return s;
end;
$$;

-- 今日の公開中の枠を、まとめて取り下げる
create or replace function public.salon_pause_today(p_salon_id uuid)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  n int;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_salon_member(p_salon_id) then raise exception 'forbidden'; end if;

  update public.slots set status = 'closed', closed_reason = 'paused', closed_at = now()
  where salon_id = p_salon_id and status = 'open'
    and start_at >= public.jst_today_start() and start_at < public.jst_today_end();
  get diagnostics n = row_count;

  insert into public.audit_logs (actor, action, target_id, detail)
  values (auth.uid(), 'pause_today', p_salon_id, jsonb_build_object('slots', n));
  return n;
end;
$$;

-- 「今日はここまで」で取り下げた枠のうち、受付の締切前のものだけを、もう一度公開する
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

-- ---------------------------------------------------------
-- 空いた時間を切り分けた枠を、まとめて作る
-- 作れる枠は作り、作れなかった枠は理由（overlap・too_late など）を返す
-- ---------------------------------------------------------
create or replace function public.create_slots(
  p_menu_id    uuid,
  p_starts     timestamptz[],
  p_stylist_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  m public.menus;
  v_start timestamptz;
  s public.slots;
  v_created jsonb := '[]'::jsonb;
  v_failed jsonb := '[]'::jsonb;
  v_code text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into m from public.menus where id = p_menu_id;
  if not found then raise exception 'menu_not_found'; end if;
  if not public.is_salon_member(m.salon_id) then raise exception 'forbidden'; end if;
  if p_starts is null or cardinality(p_starts) not between 1 and 24 then raise exception 'invalid_input'; end if;

  foreach v_start in array p_starts loop
    begin
      s := public.create_slot(p_menu_id, v_start, p_stylist_id);
      v_created := v_created || jsonb_build_object('id', s.id, 'start_at', s.start_at);
    exception when others then
      v_code := coalesce(substring(sqlerrm from '^[a-z_]+$'), 'error');
      v_failed := v_failed || jsonb_build_object('start_at', v_start, 'reason', v_code);
    end;
  end loop;

  return jsonb_build_object('created', v_created, 'failed', v_failed);
end;
$$;

-- ---------------------------------------------------------
-- いつもの空き方（空いた時間の長さ・メニュー・担当）
-- ---------------------------------------------------------
alter table public.slot_presets add column if not exists kind text not null default 'offsets';
alter table public.slot_presets add column if not exists free_minutes int;
alter table public.slot_presets drop constraint if exists slot_presets_kind_check;
alter table public.slot_presets add constraint slot_presets_kind_check
  check (kind in ('offsets', 'free') and (kind = 'offsets' or free_minutes between 15 and 240));

create or replace function public.salon_save_free_preset(
  p_salon_id     uuid,
  p_label        text,
  p_menu_id      uuid,
  p_stylist_id   uuid,
  p_free_minutes int
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
  if coalesce(btrim(p_label), '') = '' or p_free_minutes not between 15 and 240 then
    raise exception 'invalid_input';
  end if;
  insert into public.slot_presets (salon_id, label, menu_id, stylist_id, kind, free_minutes)
  values (p_salon_id, left(btrim(p_label), 40), p_menu_id, p_stylist_id, 'free', p_free_minutes)
  returning * into r;
  return r;
end;
$$;

-- ---------------------------------------------------------
-- サロンの初期設定（①メニュー ②担当 ③受け付ける性別と LINE）。3 で完了
-- ---------------------------------------------------------
alter table public.salon_private add column if not exists onboarding_step int not null default 0;
alter table public.salon_private drop constraint if exists salon_private_onboarding_check;
alter table public.salon_private add constraint salon_private_onboarding_check check (onboarding_step between 0 and 3);

-- すでにメニューを持っているサロンは、設定済みとして扱う
insert into public.salon_private (salon_id, onboarding_step)
select s.id, 3 from public.salons s
where exists (select 1 from public.menus m where m.salon_id = s.id)
on conflict (salon_id) do nothing;
update public.salon_private sp set onboarding_step = 3
where onboarding_step = 0 and exists (select 1 from public.menus m where m.salon_id = sp.salon_id);

create or replace function public.salon_set_onboarding(p_salon_id uuid, p_step int)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_salon_member(p_salon_id) then raise exception 'forbidden'; end if;
  if p_step not between 0 and 3 then raise exception 'invalid_input'; end if;
  insert into public.salon_private (salon_id, onboarding_step) values (p_salon_id, p_step)
  on conflict (salon_id) do update set onboarding_step = excluded.onboarding_step, updated_at = now();
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
    'public.book_slot(uuid, text, text, text, text)',
    'public.close_slot(uuid)',
    'public.salon_pause_today(uuid)',
    'public.salon_resume_today(uuid)',
    'public.create_slots(uuid, timestamptz[], uuid)',
    'public.salon_save_free_preset(uuid, text, uuid, uuid, int)',
    'public.salon_set_onboarding(uuid, int)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'revoke execute on function public.next_booking_no(uuid, timestamptz) from public, anon, authenticated';
end;
$$;
