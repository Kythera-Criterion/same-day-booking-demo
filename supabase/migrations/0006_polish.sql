-- =========================================================
-- 0006 仕上げ（0005 のあとに流す。何度流しても壊れない書き方にしている）
--
--   ・利用者の検索結果に担当の名前を出す（search_open_slots の戻り値に stylist_name を追加）
--   ・サロンが自店の住所・位置・エリアを設定できるようにする（承認時は仮の位置のため）
--   ・運営がサロンの掲載を止める・再開する
-- =========================================================

-- ---------------------------------------------------------
-- 今行ける枠を探す（担当の名前を追加。戻り値が変わるので作り直す）
-- ---------------------------------------------------------
drop function if exists public.search_open_slots(timestamptz, uuid);
create or replace function public.search_open_slots(
  p_until   timestamptz,
  p_area_id uuid default null
)
returns table (
  slot_id       uuid,
  start_at      timestamptz,
  end_at        timestamptz,
  deadline_at   timestamptz,
  price         int,
  menu_name     text,
  duration_min  int,
  salon_id      uuid,
  salon_name    text,
  salon_address text,
  lat           double precision,
  lng           double precision,
  stylist_name  text
)
language sql stable security definer set search_path = public
as $$
  with me as (
    select gender, area_id from public.profiles where id = auth.uid()
  )
  select s.id, s.start_at, s.end_at, s.deadline_at, s.price, m.name, m.duration_min,
         sa.id, sa.name, sa.address, sa.lat, sa.lng, st.name
  from public.slots s
  join public.menus  m  on m.id = s.menu_id
  join public.salons sa on sa.id = s.salon_id
  left join public.stylists st on st.id = s.stylist_id
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

-- ---------------------------------------------------------
-- サロン：店名・住所・位置・エリア
-- 位置は利用者の距離の計算に使う（地図サービスには渡さない）。日本の範囲だけを受け付ける
-- ---------------------------------------------------------
create or replace function public.salon_update_profile(
  p_salon_id uuid,
  p_name     text,
  p_address  text,
  p_area_id  uuid,
  p_lat      double precision,
  p_lng      double precision
)
returns public.salons
language plpgsql security definer set search_path = public
as $$
declare
  s public.salons;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_salon_member(p_salon_id) then raise exception 'forbidden'; end if;
  if coalesce(btrim(p_name), '') = '' or coalesce(btrim(p_address), '') = ''
     or p_lat is null or p_lng is null
     or p_lat not between 20 and 46 or p_lng not between 122 and 154 then
    raise exception 'invalid_input';
  end if;
  if p_area_id is not null and not exists (select 1 from public.areas where id = p_area_id) then
    raise exception 'invalid_input';
  end if;

  update public.salons
  set name = left(btrim(p_name), 80), address = left(btrim(p_address), 120),
      area_id = p_area_id, lat = p_lat, lng = p_lng
  where id = p_salon_id
  returning * into s;

  insert into public.audit_logs (actor, action, target_id, detail)
  values (auth.uid(), 'update_salon_profile', p_salon_id,
          jsonb_build_object('area_id', p_area_id, 'lat', p_lat, 'lng', p_lng));
  return s;
end;
$$;

-- ---------------------------------------------------------
-- 運営：サロンの掲載を止める・再開する
-- 止めると、そのサロンの枠は利用者の検索に出ず、予約もできなくなる（入っている予約はそのまま）
-- ---------------------------------------------------------
create or replace function public.admin_set_salon_approved(p_salon_id uuid, p_approved boolean)
returns public.salons
language plpgsql security definer set search_path = public
as $$
declare
  s public.salons;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_approved is null then raise exception 'invalid_input'; end if;
  update public.salons set is_approved = p_approved where id = p_salon_id returning * into s;
  if not found then raise exception 'not_found'; end if;
  insert into public.audit_logs (actor, action, target_id)
  values (auth.uid(), case when p_approved then 'resume_salon' else 'suspend_salon' end, p_salon_id);
  return s;
end;
$$;

-- ---------------------------------------------------------
-- 権限
-- ---------------------------------------------------------
revoke execute on function public.search_open_slots(timestamptz, uuid) from public;
grant  execute on function public.search_open_slots(timestamptz, uuid) to anon, authenticated;
revoke execute on function public.salon_update_profile(uuid, text, text, uuid, double precision, double precision) from public, anon;
grant  execute on function public.salon_update_profile(uuid, text, text, uuid, double precision, double precision) to authenticated;
revoke execute on function public.admin_set_salon_approved(uuid, boolean) from public, anon;
grant  execute on function public.admin_set_salon_approved(uuid, boolean) to authenticated;

-- ---------------------------------------------------------
-- デモ：同時予約チャレンジ用の枠は、メニューの受付締切に合わせて開始時刻を決める
-- （サロンがメニューの締切を変えても、締切切れの枠を作らない）
-- ---------------------------------------------------------
create or replace function public.demo_prepare_challenge()
returns public.slots
language plpgsql security definer set search_path = public
as $$
declare
  v_menu public.menus;
  v_start timestamptz;
  s public.slots;
begin
  update public.bookings b set status = 'completed', completed_at = now(), updated_at = now()
  from public.slots sl
  where sl.id = b.slot_id and b.status = 'confirmed' and sl.end_at > now()
    and b.user_id in (select id from auth.users where email like 'user%@demo.test');

  select * into v_menu from public.menus where id = 'd1111111-1111-4111-8111-111111111111';
  v_start := greatest(
    date_bin('5 minutes', now() + make_interval(mins => v_menu.booking_deadline_min + 30), timestamptz '2000-01-01'),
    ((now() at time zone 'Asia/Tokyo')::date + time '09:30') at time zone 'Asia/Tokyo'
  );
  if v_start + make_interval(mins => v_menu.duration_min) > public.jst_today_end() then
    raise exception 'today_only';
  end if;

  insert into public.slots (salon_id, menu_id, start_at, end_at, price)
  values (v_menu.salon_id, v_menu.id, v_start, v_start + make_interval(mins => v_menu.duration_min), v_menu.price)
  returning * into s;
  return s;
end;
$$;
revoke execute on function public.demo_prepare_challenge() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.demo_prepare_challenge() to service_role;
  end if;
end;
$$;
