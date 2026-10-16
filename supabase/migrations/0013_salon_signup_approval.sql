-- =========================================================
-- 0013 サロンの新規登録を、運営の承認制にする（0012 のあとに流す。何度流しても壊れない）
--
--   1. お店が「新規登録」で、店名・お名前・メールアドレス・パスワードを入れて申し込む
--      → 運営の「掲載希望」に届く（アカウントは、確認が済むまでログインできない）
--   2. 運営が承認すると、お店とスタッフの紐づけを作り、登録のメールアドレスへ確認のリンクを自動で送る
--   3. お店がリンクを開くと、登録が完了してログインした状態になり、初期設定（メニュー・担当・お店の場所）へ進む
--   ログインしたまま申し込む場合（すでにアカウントがある・Google／Yahoo! JAPAN ID で登録した・2店舗目）も、
--   同じく運営の承認を待ってから、確認のリンクを送る
-- =========================================================

-- ログイン中のアカウントで、掲載を申し込む（店名・お名前。エリア・住所などは、承認のあとの初期設定で入れる）
create or replace function public.salon_apply(
  p_salon_name   text,
  p_contact_name text,
  p_question     text default null
)
returns uuid
language plpgsql security definer set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
  v_email text;
  v_id uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.salon_applications where applicant_user_id = uid and status = 'pending') then
    raise exception 'application_pending';
  end if;
  if coalesce(btrim(p_salon_name), '') = '' or coalesce(btrim(p_contact_name), '') = '' then
    raise exception 'invalid_input';
  end if;
  select email into v_email from auth.users where id = uid;
  insert into public.salon_applications (salon_name, contact_name, email, area_text, question, applicant_user_id)
  values (left(btrim(p_salon_name), 80), left(btrim(p_contact_name), 60), coalesce(v_email, ''), '（初期設定で入力）',
          nullif(left(btrim(coalesce(p_question, '')), 1000), ''), uid)
  returning id into v_id;
  insert into public.audit_logs (actor, action, target_id) values (uid, 'salon_apply', v_id);
  return v_id;
end;
$$;

-- 自分の申し込みの状態（いちばん新しいもの）。サロンの画面で「運営の確認待ち」などを出すのに使う
create or replace function public.my_salon_application()
returns table (id uuid, status text, salon_name text, salon_id uuid, created_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select a.id, a.status, a.salon_name, a.salon_id, a.created_at
  from public.salon_applications a
  where a.applicant_user_id = auth.uid()
  order by a.created_at desc
  limit 1;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.salon_apply(text, text, text)',
    'public.my_salon_application()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
