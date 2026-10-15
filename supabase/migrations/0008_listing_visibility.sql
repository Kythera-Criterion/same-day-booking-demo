-- =========================================================
-- 0008 掲載を止めた・削除したサロンを、利用者の画面に出さない（0007 のあとに流す。何度流しても壊れない）
--
--   ・掲載を止めたサロンの公開中の枠は、その場で取り下げる（利用者の画面がすぐに更新される）。
--     再開すると、取り下げた枠のうち受付の締切前のものだけを戻す
--   ・掲載中でないサロンの枠は、検索だけでなく、表から直接読んでも見えないようにする
--   ・すでに予約しているお客様だけは、そのサロンの店名・住所・電話番号を読める（来店・電話のため）
--   ・取り下げ済みの枠を予約しようとしたときは「受付を終えた枠」として断る
-- =========================================================

alter table public.slots drop constraint if exists slots_closed_reason_check;
alter table public.slots add constraint slots_closed_reason_check
  check (closed_reason is null or closed_reason in ('withdrawn', 'paused', 'suspended'));

-- そのサロンが掲載中か（RLS の中で salons の権限判定を経由しないための関数）
create or replace function public.salon_is_listed(p_salon_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select is_approved from public.salons where id = p_salon_id), false);
$$;

-- ログイン中の利用者が、そのサロンを予約したことがあるか
create or replace function public.has_booking_at_salon(p_salon_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.bookings b join public.slots s on s.id = b.slot_id
    where s.salon_id = p_salon_id and b.user_id = auth.uid()
  );
$$;

-- 公開中の枠は、掲載中のサロンのものだけが見える
drop policy if exists slots_select on public.slots;
create policy slots_select on public.slots
  for select using (
    (status = 'open' and public.salon_is_listed(salon_id))
    or public.is_salon_member(salon_id)
    or public.has_booking_on_slot(id)
    or public.is_admin()
  );

-- サロンは、掲載中なら誰でも、そうでなければスタッフ・運営・予約したことのあるお客様だけが見える
drop policy if exists salons_select on public.salons;
create policy salons_select on public.salons
  for select using (
    is_approved or public.is_salon_member(id) or public.is_admin() or public.has_booking_at_salon(id)
  );

-- ---------------------------------------------------------
-- 運営：サロンの掲載を止める・再開する（枠の取り下げと戻しを含む）
-- ---------------------------------------------------------
create or replace function public.admin_set_salon_approved(p_salon_id uuid, p_approved boolean)
returns public.salons
language plpgsql security definer set search_path = public
as $$
declare
  s public.salons;
  r record;
  v_closed int := 0;
  v_reopened int := 0;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_approved is null then raise exception 'invalid_input'; end if;
  update public.salons set is_approved = p_approved where id = p_salon_id returning * into s;
  if not found then raise exception 'not_found'; end if;

  if not p_approved then
    update public.slots set status = 'closed', closed_reason = 'suspended', closed_at = now()
    where salon_id = p_salon_id and status = 'open';
    get diagnostics v_closed = row_count;
  else
    for r in
      select id from public.slots
      where salon_id = p_salon_id and status = 'closed' and closed_reason = 'suspended' and deadline_at > now()
      order by start_at
      for update
    loop
      begin
        update public.slots set status = 'open', closed_reason = null, closed_at = null where id = r.id;
        v_reopened := v_reopened + 1;
      exception when exclusion_violation then
        null;  -- 止めている間に、同じ担当の重なる枠が出ていたら戻さない
      end;
    end loop;
  end if;

  insert into public.audit_logs (actor, action, target_id, detail)
  values (auth.uid(), case when p_approved then 'resume_salon' else 'suspend_salon' end, p_salon_id,
          jsonb_build_object('closed_slots', v_closed, 'reopened_slots', v_reopened));
  return s;
end;
$$;

-- ---------------------------------------------------------
-- 予約する（0005 の内容に、取り下げ済みの枠を「受付を終えた枠」として断る判定を加えたもの）
-- ---------------------------------------------------------
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

  -- 掲載中でないサロンの枠は、存在しないものとして扱う
  select * into sal from public.salons where id = s.salon_id;
  if not sal.is_approved then raise exception 'slot_not_found'; end if;

  if s.status <> 'open' then
    if s.status = 'expired' then raise exception 'too_late'; end if;
    if s.status = 'closed' then raise exception 'slot_closed'; end if;
    raise exception 'already_booked';
  end if;
  if s.deadline_at <= now() then raise exception 'too_late'; end if;
  if s.start_at >= public.jst_today_end() then raise exception 'today_only'; end if;

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
-- 権限
-- ---------------------------------------------------------
grant execute on function public.salon_is_listed(uuid) to anon, authenticated;
grant execute on function public.has_booking_at_salon(uuid) to anon, authenticated;
revoke execute on function public.admin_set_salon_approved(uuid, boolean) from public, anon;
grant  execute on function public.admin_set_salon_approved(uuid, boolean) to authenticated;
revoke execute on function public.book_slot(uuid, text, text, text, text) from public, anon;
grant  execute on function public.book_slot(uuid, text, text, text, text) to authenticated;

-- すでに掲載を止めているサロンに公開中の枠が残っていれば、取り下げておく
update public.slots sl set status = 'closed', closed_reason = 'suspended', closed_at = now()
from public.salons sa
where sa.id = sl.salon_id and not sa.is_approved and sl.status = 'open';

-- ---------------------------------------------------------
-- 掲載の変化の知らせ（利用者の画面がすぐに読み直すため）
-- 取り下げた枠は利用者から見えないので、枠の変更は利用者の画面に届かない。
-- 代わりに「どのサロンの掲載が変わったか」だけを、誰でも受け取れる形で流す（個人の情報は含めない）
-- ---------------------------------------------------------
create table if not exists public.listing_events (
  id       bigserial primary key,
  salon_id uuid not null,
  kind     text not null check (kind in ('suspended', 'resumed', 'deleted')),
  at       timestamptz not null default now()
);
alter table public.listing_events enable row level security;
drop policy if exists listing_events_select on public.listing_events;
create policy listing_events_select on public.listing_events for select using (true);
revoke all on public.listing_events from anon, authenticated;
grant select on public.listing_events to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'listing_events'
     ) then
    alter publication supabase_realtime add table public.listing_events;
  end if;
end;
$$;

create or replace function public.note_listing_event(p_salon_id uuid, p_kind text)
returns void
language sql security definer set search_path = public
as $$
  delete from public.listing_events where at < now() - interval '1 day';
  insert into public.listing_events (salon_id, kind) values (p_salon_id, p_kind);
$$;
revoke execute on function public.note_listing_event(uuid, text) from public, anon, authenticated;

-- 掲載の停止・再開・削除のときに知らせる
create or replace function public.salons_listing_changed()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.note_listing_event(old.id, 'deleted');
    return old;
  end if;
  if new.is_approved is distinct from old.is_approved then
    perform public.note_listing_event(new.id, case when new.is_approved then 'resumed' else 'suspended' end);
  end if;
  return new;
end;
$$;
revoke execute on function public.salons_listing_changed() from public, anon, authenticated;

drop trigger if exists salons_listing_changed on public.salons;
create trigger salons_listing_changed
  after update of is_approved or delete on public.salons
  for each row execute function public.salons_listing_changed();
