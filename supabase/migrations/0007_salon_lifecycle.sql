-- =========================================================
-- 0007 サロンの承認から削除まで（0006 のあとに流す。何度流しても壊れない書き方にしている）
--
--   ・承認したサロンへ「ご利用開始のご案内」メールを送る（通知の送信待ちに積む）
--   ・ご案内メールを送った日時と回数を、掲載希望に残す（再送のため）
--   ・運営がサロンを削除する（予約の履歴がないサロンだけ。デモ用のサロンは削除しない）
-- =========================================================

-- ご利用開始のご案内メールを、通知の送信待ちに積めるようにする
alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check
  check (kind in ('booking_created', 'booking_cancelled', 'salon_cancel_mail', 'salon_welcome_mail'));

-- ご案内メールを送った日時と回数
alter table public.salon_applications add column if not exists invite_sent_at timestamptz;
alter table public.salon_applications add column if not exists invite_count int not null default 0;

-- ---------------------------------------------------------
-- 運営：サロンを削除する
--   予約の履歴（キャンセルを含む）が1件でもあるサロンは削除しない。
--   実証の数字と、お客様の予約・無断キャンセルの記録を残すため（代わりに掲載を止める）。
--   削除すると、メニュー・担当・枠・いつもの枠・非公開の設定・スタッフの紐づけも消える。
--   スタッフのアカウントそのものは、サーバー側の処理で消す（この関数は ID を返すだけ）
-- ---------------------------------------------------------
create or replace function public.admin_delete_salon(p_salon_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  s public.salons;
  v_staff uuid[];
  v_slots int;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select * into s from public.salons where id = p_salon_id for update;
  if not found then raise exception 'not_found'; end if;
  if p_salon_id in (
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333'
  ) then
    raise exception 'demo_salon';
  end if;
  if exists (
    select 1 from public.bookings b join public.slots sl on sl.id = b.slot_id where sl.salon_id = p_salon_id
  ) then
    raise exception 'has_bookings';
  end if;

  select coalesce(array_agg(user_id), '{}') into v_staff from public.salon_members where salon_id = p_salon_id;
  select count(*) into v_slots from public.slots where salon_id = p_salon_id;

  delete from public.slot_presets where salon_id = p_salon_id;
  delete from public.slots where salon_id = p_salon_id;
  delete from public.salons where id = p_salon_id;

  insert into public.audit_logs (actor, action, target_id, detail)
  values (auth.uid(), 'delete_salon', p_salon_id,
          jsonb_build_object('name', s.name, 'slots', v_slots, 'staff', cardinality(v_staff)));
  return jsonb_build_object('name', s.name, 'staff', to_jsonb(v_staff), 'slots', v_slots);
end;
$$;

revoke execute on function public.admin_delete_salon(uuid) from public, anon;
grant  execute on function public.admin_delete_salon(uuid) to authenticated;
