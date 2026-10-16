-- =========================================================
-- 0010 1つのアカウントで複数のお店（0009 のあとに流す。何度流しても壊れない書き方にしている）
--
--   ・すでにどこかのお店のスタッフ（または運営・お客様）のアカウントでも、別のお店の掲載を申し込める
--     （系列店・2店舗目。これまでは「登録済み」として断り、運営に掲載希望が届かなかった）
--   ・同じアカウントの審査中の自己登録が残っている間は、二重に申し込めない
-- =========================================================

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
  -- 二重の送信を防ぐ：審査中の自己登録が残っていれば断る（掲載中のお店のスタッフでも、別のお店は申し込める）
  if exists (
    select 1 from public.salon_applications
    where applicant_user_id = uid and status = 'pending'
  ) then
    raise exception 'application_pending';
  end if;
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

revoke execute on function public.salon_self_register(text, text, text, uuid, text, text) from public, anon;
grant  execute on function public.salon_self_register(text, text, text, uuid, text, text) to authenticated;
