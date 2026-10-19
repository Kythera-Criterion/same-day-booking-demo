'use client';

// 運営へのお問い合わせ（お客様のマイページ・サロンの設定）：種類・件名・本文（お客様は予約番号も）を送り、送ったものの状態を見られる。
// 0022 を流していないデータベースでは出さない

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import Button from '@/components/ui/Button';
import { Input, LabeledField, Select, Textarea } from '@/components/ui/Form';
import Label, { type LabelKind } from '@/components/ui/Label';
import Notice from '@/components/ui/Notice';
import { Panel, SectionHead, SubText } from '@/components/ui/Surface';
import { ChatCircle, PaperPlaneTilt } from '@/components/ui/icons';
import { toMessage } from '@/lib/errors';
import s from './InquiryForm.module.css';

export type InquiryStatus = 'open' | 'in_progress' | 'resolved';
export const INQUIRY_STATUS: Record<InquiryStatus, { text: string; kind: LabelKind }> = {
  open: { text: '未対応', kind: 'time' },
  in_progress: { text: '対応中', kind: 'action' },
  resolved: { text: '解決済み', kind: 'success' },
};
export const INQUIRY_CATEGORY: Record<string, string> = {
  booking: '予約について',
  account: 'アカウント・ログインについて',
  listing: '掲載・お店の設定について',
  other: 'そのほか',
};

type Sent = { id: string; no: number; subject: string; category: string; status: InquiryStatus; created_at: string; admin_note: string | null };
const dt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function InquiryForm({
  client,
  role,
  userId,
  salonId = null,
}: {
  client: SupabaseClient;
  role: 'user' | 'salon';
  userId: string;
  salonId?: string | null;
}) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [sent, setSent] = useState<Sent[]>([]);
  const [category, setCategory] = useState(role === 'salon' ? 'listing' : 'booking');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [bookingNo, setBookingNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    let query = client.from('inquiries').select('id,no,subject,category,status,created_at,admin_note').order('created_at', { ascending: false }).limit(10);
    query = role === 'salon' && salonId ? query.eq('salon_id', salonId).eq('from_role', 'salon') : query.eq('user_id', userId).eq('from_role', 'user');
    const { data, error } = await query;
    setSupported(!error);
    if (!error) setSent((data ?? []) as Sent[]);
  }, [client, role, salonId, userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    setBusy(true);
    setMessage(null);
    const { data, error } = await client.rpc('submit_inquiry', {
      p_from_role: role,
      p_salon_id: salonId,
      p_category: category,
      p_subject: subject,
      p_body: body,
      p_booking_no: role === 'user' ? bookingNo : null,
    });
    setBusy(false);
    if (error) {
      setMessage({ kind: 'error', text: toMessage(error) });
      return;
    }
    setMessage({ kind: 'ok', text: `お問い合わせを受け付けました（受付番号 Q-${(data as { no: number }).no}）。運営からの返事は、ご登録のメールアドレスへお送りします。` });
    setSubject('');
    setBody('');
    setBookingNo('');
    load();
  }

  if (!supported) return null;

  return (
    <Panel>
      <SectionHead icon={ChatCircle} title="運営へのお問い合わせ" as="h2" />
      <SubText>{role === 'salon' ? '掲載・設定・予約の扱いなどで困ったときに、運営事務局へ送れます。' : '予約やアカウントのことで困ったときに、運営事務局へ送れます。'}</SubText>
      {message && <Notice tone={message.kind === 'ok' ? 'success' : 'danger'}>{message.text}</Notice>}
      <div className={s.form}>
        <LabeledField label="種類">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {Object.entries(INQUIRY_CATEGORY).map(([key, text]) => (
              <option key={key} value={key}>
                {text}
              </option>
            ))}
          </Select>
        </LabeledField>
        <LabeledField label="件名">
          <Input maxLength={80} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="例：予約の時間を変えたい" />
        </LabeledField>
        {role === 'user' && (
          <LabeledField label="予約番号（わかれば）" hint="予約の画面に出ている番号です。">
            <Input className="num" maxLength={20} value={bookingNo} onChange={(e) => setBookingNo(e.target.value)} />
          </LabeledField>
        )}
        <LabeledField label="内容">
          <Textarea maxLength={2000} rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
        </LabeledField>
        <Button variant="primary" size="md" icon={PaperPlaneTilt} disabled={busy || !subject.trim() || !body.trim()} onClick={submit}>
          {busy ? '送っています…' : '送る'}
        </Button>
      </div>
      {sent.length > 0 && (
        <div className={s.sent}>
          <p className={s.sentTitle}>送ったお問い合わせ</p>
          <ul className={s.sentList}>
            {sent.map((q) => (
              <li key={q.id}>
                <span className={s.sentHead}>
                  <span className="num">Q-{q.no}</span>
                  <strong>{q.subject}</strong>
                  <Label kind={INQUIRY_STATUS[q.status].kind}>{INQUIRY_STATUS[q.status].text}</Label>
                </span>
                <small className="num">
                  {INQUIRY_CATEGORY[q.category] ?? q.category} ・ {dt.format(new Date(q.created_at))}
                </small>
                {q.admin_note && q.status === 'resolved' && <span className={s.note}>運営より：{q.admin_note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
