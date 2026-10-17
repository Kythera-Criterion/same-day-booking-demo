-- =========================================================
-- 0015：サロンが公開中の枠を取り下げたとき（「今日はここまで」・1枠の取り下げ・掲載の停止）も、
--       利用者の画面がすぐに読み直すよう知らせる
--
-- 取り下げた枠（closed）は利用者から見えないため、枠の変更（Realtime）は利用者の画面に届かない。
-- そのため「今日はここまで」を押しても、利用者の画面は別のページへ移って戻るまで、そのサロンの枠を出し続けていた。
-- （再開は、枠が見える状態に戻るので、これまでもすぐに届いていた）
-- 0008 の listing_events（どのサロンの掲載が変わったかだけを、誰でも受け取れる形で流す。個人の情報は含めない）に、
-- 公開中の枠が取り下げられたこと（kind = 'closed'）も流す。利用者の画面は、この知らせで空き枠を読み直す。
--
-- 何度流しても同じ結果になる（冪等）
-- =========================================================

-- 知らせの種類に 'closed'（公開中の枠の取り下げ）を加える
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.listing_events'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table public.listing_events drop constraint %I', c.conname);
  end loop;
end;
$$;
alter table public.listing_events
  add constraint listing_events_kind_check check (kind in ('suspended', 'resumed', 'deleted', 'closed'));

-- 公開中（open）の枠が取り下げ（closed）になったら、そのサロンについて1回だけ知らせる
--   文（statement）ごとに1回動くので、「今日はここまで」でまとめて取り下げても、知らせはサロンごとに1件
--   予約（booked）・時間切れ（expired）では知らせない（予約は予約した本人に届き、時間切れは画面が時刻でも絞っている）
create or replace function public.slots_note_closed()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  r record;
begin
  for r in
    select distinct n.salon_id
    from new_rows n
    join old_rows o on o.id = n.id
    where o.status = 'open' and n.status = 'closed'
  loop
    perform public.note_listing_event(r.salon_id, 'closed');
  end loop;
  return null;
end;
$$;
revoke execute on function public.slots_note_closed() from public, anon, authenticated;

drop trigger if exists slots_note_closed on public.slots;
create trigger slots_note_closed
  after update on public.slots
  referencing old table as old_rows new table as new_rows
  for each statement
  execute function public.slots_note_closed();
