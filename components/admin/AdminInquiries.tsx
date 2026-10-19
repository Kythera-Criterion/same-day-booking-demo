'use client';

// 運営の「問い合わせ」：お客様・サロンからの問い合わせ。状態（未対応・対応中・解決済み）で絞り込み、押すと中身を見て状態とメモを変えられる。
// 新しい問い合わせは、その場で一覧に出る（Realtime）。0022 を流していないデータベースでは、その旨を出す

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import Sheet from '@/components/Sheet';
import { Empty, ErrorState, Loading } from '@/components/States';
import { INQUIRY_CATEGORY, INQUIRY_STATUS, type InquiryStatus } from '@/components/InquiryForm';
import Button from '@/components/ui/Button';
import { LabeledField, Segmented, Textarea } from '@/components/ui/Form';
import Label from '@/components/ui/Label';
import { Pair } from '@/components/ui/Layout';
import Notice from '@/components/ui/Notice';
import { Panel, SectionHead, SubText } from '@/components/ui/Surface';
import { ChatCircle, Storefront, User } from '@/components/ui/icons';
import { one } from '@/lib/supabase';
import { toMessage } from '@/lib/errors';
import s from './AdminInquiries.module.css';

type Inquiry = {
  id: string;
  no: number;
  from_role: 'user' | 'salon';
  category: string;
  subject: string;
  body: string;
  booking_no: string | null;
  contact_email: string | null;
  status: InquiryStatus;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
  salons: { name: string } | { name: string }[] | null;
};
type Filter = 'active' | InquiryStatus | 'all';

const dt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function AdminInquiries({ client, onChanged }: { client: SupabaseClient; onChanged?: () => void }) {
  const [list, setList] = useState<Inquiry[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('active');
  const [open, setOpen] = useState<Inquiry | null>(null);
  const [status, setStatus] = useState<InquiryStatus>('open');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: e } = await client
      .from('inquiries')
      .select('id,no,from_role,category,subject,body,booking_no,contact_email,status,admin_note,created_at,updated_at,salons(name)')
      .order('created_at', { ascending: false })
      .limit(200);
    if (e) {
      if (/inquiries|schema cache|does not exist/i.test(e.message)) setMissing(true);
      else setError(toMessage(e));
      return;
    }
    setError(null);
    setList((data ?? []) as unknown as Inquiry[]);
  }, [client]);

  useEffect(() => {
    load();
    const channel = client
      .channel(`admin-inquiries-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inquiries' }, () => load())
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [client, load]);

  function show(q: Inquiry) {
    setOpen(q);
    setStatus(q.status);
    setNote(q.admin_note ?? '');
    setSaved(null);
  }

  async function save() {
    if (!open) return;
    setBusy(true);
    const { error: e } = await client.rpc('admin_update_inquiry', { p_id: open.id, p_status: status, p_note: note });
    setBusy(false);
    if (e) {
      setSaved(toMessage(e));
      return;
    }
    setOpen(null);
    load();
    onChanged?.();
  }

  if (missing) return <Notice tone="info">問い合わせは、データベースの更新（0022）のあとに使えます。</Notice>;
  if (error) return <ErrorState onRetry={load}>{error}</ErrorState>;
  if (!list) return <Loading rows={3} />;

  const counts = {
    open: list.filter((q) => q.status === 'open').length,
    in_progress: list.filter((q) => q.status === 'in_progress').length,
    resolved: list.filter((q) => q.status === 'resolved').length,
  };
  const shown = list.filter((q) => (filter === 'all' ? true : filter === 'active' ? q.status !== 'resolved' : q.status === filter));

  return (
    <Panel>
      <SectionHead icon={ChatCircle} title="問い合わせ" as="h2" />
      <SubText>お客様のマイページと、サロンの設定から届きます。押すと中身を見て、状態とメモを変えられます。</SubText>
      <Segmented
        label="状態で絞り込む"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'active', label: '未解決', count: counts.open + counts.in_progress },
          { value: 'open', label: '未対応', count: counts.open },
          { value: 'in_progress', label: '対応中', count: counts.in_progress },
          { value: 'resolved', label: '解決済み', count: counts.resolved },
          { value: 'all', label: 'すべて', count: list.length },
        ]}
      />
      {shown.length === 0 ? (
        <Empty icon={ChatCircle}>この状態の問い合わせはありません。</Empty>
      ) : (
        <ul className={s.list}>
          {shown.map((q) => (
            <li key={q.id}>
              <button type="button" className={s.item} onClick={() => show(q)}>
                <span className={s.from}>
                  {q.from_role === 'salon' ? <Storefront size={20} aria-hidden focusable="false" /> : <User size={20} aria-hidden focusable="false" />}
                </span>
                <span className={s.body}>
                  <span className={s.head}>
                    <span className={`${s.no} num`}>Q-{q.no}</span>
                    <strong>{q.subject}</strong>
                  </span>
                  <small className="num">
                    {q.from_role === 'salon' ? `サロン：${one(q.salons)?.name ?? '（お店なし）'}` : 'お客様'} ・ {INQUIRY_CATEGORY[q.category] ?? q.category} ・ {dt.format(new Date(q.created_at))}
                  </small>
                </span>
                <Label kind={INQUIRY_STATUS[q.status].kind}>{INQUIRY_STATUS[q.status].text}</Label>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <Sheet label={`問い合わせ Q-${open.no}`} title={`Q-${open.no} ${open.subject}`} narrow onClose={() => setOpen(null)}>
          <dl className={s.meta}>
            <div>
              <dt>送った人</dt>
              <dd>{open.from_role === 'salon' ? `サロン（${one(open.salons)?.name ?? '—'}）` : 'お客様'}</dd>
            </div>
            <div>
              <dt>種類</dt>
              <dd>{INQUIRY_CATEGORY[open.category] ?? open.category}</dd>
            </div>
            <div>
              <dt>受付</dt>
              <dd className="num">{dt.format(new Date(open.created_at))}</dd>
            </div>
            {open.booking_no && (
              <div>
                <dt>予約番号</dt>
                <dd className="num">{open.booking_no}</dd>
              </div>
            )}
            <div>
              <dt>返信先</dt>
              <dd className="break">{open.contact_email ?? '—'}</dd>
            </div>
          </dl>
          <p className={s.text}>{open.body}</p>
          <div className={s.statusRow}>
            <Segmented
              label="状態"
              value={status}
              onChange={setStatus}
              options={(Object.keys(INQUIRY_STATUS) as InquiryStatus[]).map((k) => ({ value: k, label: INQUIRY_STATUS[k].text }))}
            />
          </div>
          <LabeledField label="運営のメモ" hint="解決済みにすると、メモは送った人の画面に「運営より」として出ます。">
            <Textarea rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </LabeledField>
          {saved && <Notice tone="danger">{saved}</Notice>}
          <Pair>
            <Button variant="quiet" size="md" onClick={() => setOpen(null)}>
              閉じる
            </Button>
            <Button variant="primary" size="md" disabled={busy} onClick={save}>
              保存する
            </Button>
          </Pair>
        </Sheet>
      )}
    </Panel>
  );
}
