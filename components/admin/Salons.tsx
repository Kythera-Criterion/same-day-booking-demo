'use client';

// サロンの一覧：掲載の状態・場所の設定・メニューとスタッフの数・今日の枠と予約。掲載を止める・再開する

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import Sheet from '@/components/Sheet';
import { Empty, ErrorState, Loading } from '@/components/States';
import Button from '@/components/ui/Button';
import { Input, LabeledField } from '@/components/ui/Form';
import Label from '@/components/ui/Label';
import { Pair, Stack } from '@/components/ui/Layout';
import Notice from '@/components/ui/Notice';
import { Panel, SectionHead, SubText } from '@/components/ui/Surface';
import { ArrowCounterClockwise, CheckCircle, HourglassMedium, PauseCircle, Sparkle, Storefront, TrashSimple } from '@/components/ui/icons';
import { one } from '@/lib/supabase';
import { toMessage } from '@/lib/errors';
import { jstTodayEnd, jstTodayStart } from '@/lib/time';
import tb from './AdminTable.module.css';
import sl from './Salons.module.css';

type Row = {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  is_approved: boolean;
  accepts_genders: string[];
  areas: { name: string } | { name: string }[] | null;
  menus: { count: number }[];
  salon_members: { count: number }[];
  slots: { bookings: { count: number }[] }[];
  salon_applications: { status: string }[] | null;
  // 初期設定の進み具合（3 で完了）と、初めて設定を終えて加わった日時
  salon_private: { onboarding_step: number; joined_at: string | null } | { onboarding_step: number; joined_at: string | null }[] | null;
};

const joinedFmt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const DEMO_SALONS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
];
const DELETE_ERROR: Record<string, string> = {
  has_bookings: '予約の履歴があるため削除できません。実証の数字と、お客様の予約・無断キャンセルの記録を残すためです。代わりに掲載を止めてください。',
  demo_salon: 'デモ用のサロンは削除できません。',
  forbidden: 'この操作の権限がありません。',
  not_found: 'サロンが見つかりませんでした。',
};
type Today = { salon_id: string; status: string; bookings: { status: string }[] | null };

// fresh：運営の画面で「新しいサロンが加わりました」と知らせたお店（一覧で目立たせる）
export default function Salons({ client, fresh = [] }: { client: SupabaseClient; fresh?: string[] }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [today, setToday] = useState<Today[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<Row | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, t] = await Promise.all([
      client
        .from('salons')
        .select('id,name,address,phone,is_approved,accepts_genders,areas(name),menus(count),salon_members(count),slots(bookings(count)),salon_applications(status),salon_private(onboarding_step,joined_at)')
        .order('name'),
      client
        .from('slots')
        .select('salon_id,status,bookings(status)')
        .gte('start_at', jstTodayStart().toISOString())
        .lt('start_at', jstTodayEnd().toISOString())
        .eq('demo_history', false),
    ]);
    if (s.error || t.error) {
      setError(toMessage(s.error ?? t.error));
      return;
    }
    setError(null);
    setRows((s.data ?? []) as unknown as Row[]);
    setToday((t.data ?? []) as unknown as Today[]);
  }, [client]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle() {
    if (!target) return;
    setBusy(true);
    const { error: e } = await client.rpc('admin_set_salon_approved', { p_salon_id: target.id, p_approved: !target.is_approved });
    setBusy(false);
    if (e) {
      setMessage(
        e.message.includes('application_pending')
          ? `${target.name} は審査中です。「掲載希望」のタブで承認すると、掲載が始まります。`
          : e.message.includes('application_rejected')
            ? `${target.name} は掲載を見送ったお店です。掲載するには、改めて申し込みを受けてください。`
            : toMessage(e),
      );
    } else {
      setMessage(target.is_approved ? `${target.name} の掲載を止めました。` : `${target.name} の掲載を再開しました。`);
    }
    setTarget(null);
    load();
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    setRemoveError(null);
    const token = (await client.auth.getSession()).data.session?.access_token;
    const res = await fetch('/api/admin/delete-salon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ salonId: removing.id }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; name?: string; removedStaff?: string[]; keptStaff?: string[] };
    setBusy(false);
    if (!res.ok) {
      setRemoveError(DELETE_ERROR[body.error ?? ''] ?? `削除できませんでした（${body.error ?? res.status}）`);
      return;
    }
    setMessage(
      `${body.name} を削除しました。` +
        ((body.removedStaff?.length ?? 0) > 0 ? `スタッフのアカウント（${body.removedStaff!.join('、')}）も削除しました。` : '') +
        ((body.keptStaff?.length ?? 0) > 0 ? `ほかでも使われているアカウント（${body.keptStaff!.join('、')}）は残しました。` : ''),
    );
    setRemoving(null);
    setConfirmName('');
    load();
  }

  if (error) return <ErrorState onRetry={load}>{error}</ErrorState>;
  if (!rows) return <Loading rows={3} />;
  if (rows.length === 0)
    return (
      <Panel>
        <Empty icon={Storefront}>サロンはまだありません。掲載希望を承認すると、ここに表示されます。</Empty>
      </Panel>
    );

  return (
    <Stack gap={4}>
      {message && (
        <Notice tone="success" role="status">
          {message}
        </Notice>
      )}
      <Panel flush>
        <div className={sl.head}>
          <SectionHead icon={Storefront} title="サロンの一覧" as="p" aside={<span className="num">{rows.length}店</span>} />
        </div>
        <div className={tb.wrap}>
          <table className={tb.table}>
            <thead>
              <tr>
                <th scope="col">サロン</th>
                <th scope="col">エリア</th>
                <th scope="col">受付</th>
                <th scope="col">メニュー・スタッフ</th>
                <th scope="col">今日</th>
                <th scope="col">掲載</th>
                <th scope="col">削除</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const mine = today.filter((x) => x.salon_id === r.id);
                const booked = mine.filter((x) => (x.bookings ?? []).some((b) => !b.status.startsWith('cancelled'))).length;
                const open = mine.filter((x) => x.status === 'open').length;
                const noPlace = !r.address.trim();
                const history = (r.slots ?? []).reduce((sum, x) => sum + (x.bookings?.[0]?.count ?? 0), 0);
                const isDemo = DEMO_SALONS.includes(r.id);
                // 審査を通っていないお店（自己登録の審査中・見送り）は、「掲載を再開」ではなく「掲載希望」の承認で掲載する
                const apps = r.salon_applications ?? [];
                const review = r.is_approved || apps.some((a) => a.status === 'approved') ? null : apps.some((a) => a.status === 'pending') ? '審査中' : apps.some((a) => a.status === 'rejected') ? '見送り' : null;
                const setup = one(r.salon_private);
                const why = isDemo ? 'デモ用のサロンは削除できません' : history > 0 ? `予約の履歴が${history}件あるため削除できません（掲載を止めてください）` : null;
                const isFresh = fresh.includes(r.id);
                return (
                  <tr key={r.id} className={isFresh ? sl.fresh : undefined} data-fresh={isFresh ? '' : undefined}>
                    <td className={sl.salonCell}>
                      <span className={sl.nameRow}>
                        <strong className={tb.name}>{r.name}</strong>
                        {isFresh && (
                          <Label kind="success" icon={Sparkle}>
                            新しく加わりました
                          </Label>
                        )}
                      </span>
                      <small className={`${tb.line} ${noPlace ? sl.warn : ''}`}>{noPlace ? '⚠ 住所・場所が未設定' : r.address}</small>
                      <small className={tb.line}>
                        {setup?.joined_at ? (
                          <>
                            <span className="num">{joinedFmt.format(new Date(setup.joined_at))}</span> に加わりました（初期設定を完了）
                          </>
                        ) : (
                          <>
                            初期設定中（<span className="num">{Math.min(setup?.onboarding_step ?? 0, 3)}/3</span>）・まだ使い始めていません
                          </>
                        )}
                      </small>
                    </td>
                    <td className={tb.nowrap}>{one(r.areas)?.name ?? '未設定'}</td>
                    <td className={tb.nowrap}>{r.accepts_genders.length === 2 ? 'どなたでも' : r.accepts_genders.includes('female') ? '女性のみ' : '男性のみ'}</td>
                    <td className={`num ${tb.nowrap}`}>
                      メニュー {r.menus[0]?.count ?? 0}
                      <small className={tb.line}>スタッフ {r.salon_members[0]?.count ?? 0}</small>
                    </td>
                    <td className={`num ${tb.nowrap}`}>
                      予約 {booked}
                      <small className={tb.line}>公開中 {open}</small>
                    </td>
                    <td>
                      <Label
                        kind={r.is_approved ? 'success' : review === '審査中' ? 'action' : 'state'}
                        icon={r.is_approved ? CheckCircle : review === '審査中' ? HourglassMedium : PauseCircle}
                      >
                        {r.is_approved ? '掲載中' : (review ?? '停止中')}
                      </Label>
                      <div className={sl.cellAction}>
                        {review ? (
                          <small className={tb.line}>{review === '審査中' ? '「掲載希望」で承認' : '掲載していません'}</small>
                        ) : (
                          <Button variant="text" onClick={() => setTarget(r)}>
                            {r.is_approved ? '掲載を止める' : '掲載を再開'}
                          </Button>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className={sl.cellAction}>
                        <Button
                          variant="text"
                          icon={TrashSimple}
                          className={sl.danger}
                          disabled={!!why}
                          title={why ?? undefined}
                          onClick={() => {
                            setRemoving(r);
                            setConfirmName('');
                            setRemoveError(null);
                          }}
                        >
                          削除
                        </Button>
                      </div>
                      <small className={`${tb.line} ${tb.nowrap}`}>{isDemo ? 'デモ用' : history > 0 ? `予約の履歴 ${history}件` : '予約の履歴なし'}</small>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {target && (
        <Sheet label={target.is_approved ? '掲載を止めますか' : '掲載を再開しますか'} role="alertdialog" narrow onClose={() => setTarget(null)}>
          <SectionHead
            icon={target.is_approved ? PauseCircle : ArrowCounterClockwise}
            title={`${target.name} の${target.is_approved ? '掲載を止めますか？' : '掲載を再開しますか？'}`}
            as="p"
          />
          {(() => {
            const mine = today.filter((x) => x.salon_id === target.id);
            const open = mine.filter((x) => x.status === 'open').length;
            const upcoming = mine.filter((x) => (x.bookings ?? []).some((b) => b.status === 'confirmed')).length;
            return target.is_approved ? (
              <ul className={sl.points}>
                <li>公開中の枠（今日 {open}件）をすぐに取り下げ、利用者の画面から消します。新しい予約もできなくなります。</li>
                <li>
                  これからの予約（今日 {upcoming}件）はそのまま残ります。予約したお客様には、来店のためにお店の情報が表示され続けます。
                  {upcoming > 0 && '必要に応じて、サロンへご連絡ください。'}
                </li>
                <li>サロンの画面には「掲載が止められています」と表示されます。再開はいつでもできます。</li>
              </ul>
            ) : (
              <SubText>再開すると、止めたときに取り下げた枠のうち、受付の締切前のものを再び公開し、利用者の検索に出します。</SubText>
            );
          })()}
          <Pair>
            <Button variant="quiet" size="md" onClick={() => setTarget(null)}>
              やめる
            </Button>
            <Button variant={target.is_approved ? 'dangerSolid' : 'primary'} size="md" disabled={busy} onClick={toggle}>
              {target.is_approved ? '掲載を止める' : '掲載を再開する'}
            </Button>
          </Pair>
        </Sheet>
      )}

      {removing && (
        <Sheet label="サロンを削除しますか" role="alertdialog" narrow onClose={() => setRemoving(null)}>
          <SectionHead icon={TrashSimple} title={`${removing.name} を削除しますか？`} as="p" />
          <ul className={sl.points}>
            <li>サロン・メニュー・担当・今日までの枠・いつもの枠・LINE の設定を削除します。元に戻せません。</li>
            <li>このサロンだけのスタッフのアカウントも削除します（ほかのサロン・運営・利用者としても使われているアカウントは残します）。</li>
            <li>掲載希望の記録と操作の記録は残ります。</li>
            <li>予約の履歴があるサロンは削除できません。その場合は掲載を止めてください。</li>
          </ul>
          <LabeledField label={`確認のため、店名「${removing.name}」を入力してください`}>
            <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
          </LabeledField>
          {removeError && (
            <div className={sl.removeError}>
              <Notice tone="danger" role="alert">
                {removeError}
              </Notice>
            </div>
          )}
          <Pair>
            <Button variant="quiet" size="md" onClick={() => setRemoving(null)}>
              やめる
            </Button>
            <Button variant="dangerSolid" size="md" disabled={busy || confirmName.trim() !== removing.name} onClick={remove}>
              {busy ? '削除中…' : '削除する'}
            </Button>
          </Pair>
        </Sheet>
      )}
    </Stack>
  );
}
