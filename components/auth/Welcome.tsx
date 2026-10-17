'use client';

// 招待・ご利用開始のメールのリンクから開く画面
//   サロンのスタッフ（承認した掲載希望の「ご利用開始のご案内」）と、運営メンバー（「運営メンバーへのご招待」、role=admin）
//   1. リンクを確かめて、その役割の画面のログイン状態にする
//   2. ログイン用のパスワードを決める（まだパスワードのないアカウントのとき。招待・再送のリンクのどちらでも）
//   3. 画面へ進む（サロンは、初めてなら3つの初期設定から）

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import AppHeader from '@/components/AppHeader';
import { Loading, NotConfigured } from '@/components/States';
import PasswordInput from '@/components/auth/PasswordInput';
import Button, { ButtonLink } from '@/components/ui/Button';
import { Field } from '@/components/ui/Form';
import { Page } from '@/components/ui/Layout';
import { Panel, SectionHead, SubText } from '@/components/ui/Surface';
import { ArrowRight, CheckCircle, LinkIcon, Sparkle } from '@/components/ui/icons';
import type { Session } from '@supabase/supabase-js';
import { isConfigured, getClient } from '@/lib/supabase';
import { notifyDesktop } from '@/lib/desktop-notify';
import { rememberSalon } from '@/components/salon/useSalonData';
import s from './Welcome.module.css';

type Phase = 'checking' | 'password' | 'ready' | 'invalid';

export default function Welcome({
  tokenHash,
  type,
  role: roleParam,
  salonId,
}: {
  tokenHash: string | null;
  type: string | null;
  role?: string | null;
  salonId?: string | null;
}) {
  const role = roleParam === 'admin' ? 'admin' : 'salon';
  const isAdmin = role === 'admin';
  const home = isAdmin ? '/admin' : '/salon';
  const [phase, setPhase] = useState<Phase>('checking');
  const [salonName, setSalonName] = useState<string | null>(null);
  const [email, setEmail] = useState<string>('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // リンクを確かめられなかったが、この端末で別のアカウントがログインしているとき（そのアカウントで続けるかを選ぶ）
  const [other, setOther] = useState<string | null>(null);
  const started = useRef(false);

  const proceed = useCallback(
    async (session: Session, fromLink = false) => {
      setEmail(session.user.email ?? '');
      const client = getClient(role);
      if (!isAdmin) {
        // 承認したお店（リンクに付いている）を、サロンの画面で開くお店にする（2店舗目の承認でも、そのお店が開く）
        let query = client.from('salon_members').select('salon_id,salons(name)').eq('user_id', session.user.id);
        if (salonId && /^[0-9a-f-]{36}$/i.test(salonId)) query = query.eq('salon_id', salonId);
        const { data: member } = await query.limit(1).maybeSingle();
        const salon = member?.salons as { name: string } | { name: string }[] | null | undefined;
        const name = Array.isArray(salon) ? (salon[0]?.name ?? null) : (salon?.name ?? null);
        setSalonName(name);
        // リンクを開いて登録が完了した：パソコンに通知する（申し込みのときに許可されていれば。読み直しでは出さない）
        if (fromLink) notifyDesktop('サロンの登録が完了しました', `${name ?? 'お店'} の掲載が承認され、サロンの画面で使えるようになりました。`, 'salon-signup');
        if (member?.salon_id) rememberSalon(session.user.id, member.salon_id as string);
      }
      // パスワードがまだないアカウントなら、ここで決めてもらう（ないままだと、あとでログインできないため）
      const res = await fetch('/api/auth/identities', { headers: { Authorization: `Bearer ${session.access_token}` } }).catch(() => null);
      const body = (await res?.json().catch(() => null)) as { hasPassword?: boolean } | null;
      setPhase(res?.ok && body?.hasPassword === false ? 'password' : 'ready');
    },
    [role, isAdmin, salonId],
  );

  useEffect(() => {
    if (!isConfigured || started.current) return;
    started.current = true;
    (async () => {
      const client = getClient(role);
      let session: Session | null = null;
      if (tokenHash && (type === 'invite' || type === 'magiclink')) {
        const { data, error: e } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
        // リンクの情報を URL に残さない
        window.history.replaceState(null, '', isAdmin ? '/welcome?role=admin' : '/welcome');
        if (e || !data.session) {
          // 期限切れ・使用済みのリンク：この端末でログインしているアカウントがあっても、黙ってそのアカウントで進めない
          const { data: s0 } = await client.auth.getSession();
          setOther(s0.session?.user.email ?? null);
          setPhase('invalid');
          return;
        }
        session = data.session;
        // 招待のリンク：パスワードを決めるまで「パスワードなし」として扱う（読み直しても、パスワードを決める画面に戻る）
        if (type === 'invite') {
          await fetch('/api/auth/identities', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } }).catch(() => null);
        }
      } else {
        // リンクを確かめたあとに読み直した場合など：この画面でログインした状態のまま続ける
        session = (await client.auth.getSession()).data.session;
        if (!session) {
          setPhase('invalid');
          return;
        }
      }
      await proceed(session, !!tokenHash);
    })();
  }, [tokenHash, type, role, isAdmin, proceed]);

  async function continueAsOther() {
    const { data } = await getClient(role).auth.getSession();
    if (!data.session) return;
    setOther(null);
    setPhase('checking');
    await proceed(data.session);
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return setError('パスワードは8文字以上で入力してください。');
    if (pw !== pw2) return setError('確認のため、同じパスワードをもう一度入力してください。');
    setBusy(true);
    setError(null);
    const { error: e2 } = await getClient(role).auth.updateUser({ password: pw, data: { password_set: true } });
    setBusy(false);
    if (e2) {
      setError(
        /weak|characters/i.test(e2.message)
          ? 'もっと推測されにくいパスワードにしてください（英字・数字・記号を混ぜる）。'
          : 'パスワードを設定できませんでした。もう一度お試しください。',
      );
      return;
    }
    setPhase('ready');
  }

  if (!isConfigured) return <NotConfigured />;

  return (
    <Page>
      <AppHeader role={isAdmin ? '運営' : 'サロン'} home={home} />
      {phase === 'checking' && (
        <div className={s.checking}>
          <p className={s.status}>リンクを確かめています…</p>
          <Loading rows={2} />
        </div>
      )}

      {phase === 'invalid' && (
        <Panel as="section" className={s.panel}>
          <SectionHead icon={LinkIcon} title="このリンクは使えません" as="p" />
          <SubText>
            {isAdmin
              ? '有効期限が切れたか、すでに使われたリンクです。招待した運営メンバーに、招待の再送を依頼してください。パスワードを設定済みの方は、運営の画面からログインできます。'
              : '有効期限が切れたか、すでに使われたリンクです。お手数ですが、運営事務局へご連絡ください。新しいリンクをお送りします。パスワードを設定済みの方は、サロンの画面からログインできます。'}
          </SubText>
          <ButtonLink href={home} variant="secondary" size="md" block>
            {isAdmin ? '運営のログインへ' : 'サロンのログインへ'}
          </ButtonLink>
          {other && (
            <Button variant="text" block className={s.other} onClick={continueAsOther}>
              ログイン中のアカウント（{other}）で続ける
            </Button>
          )}
        </Panel>
      )}

      {phase === 'password' && (
        <Panel as="form" roomy className={s.panel} onSubmit={savePassword} noValidate>
          <p className={s.kicker}>
            <Sparkle size={20} weight="duotone" aria-hidden focusable="false" />
            ようこそ
          </p>
          <h1 className={s.title}>{isAdmin ? '運営メンバーへのご招待' : salonName ? `${salonName} 様` : 'ご利用開始の手続き'}</h1>
          <p className={s.text}>
            {isAdmin ? '運営メンバーに招待されました。' : '掲載が承認されました。'}はじめに、ログイン用のパスワードを決めてください。ログイン用メールアドレスは <strong className="break">{email}</strong> です。
          </p>
          <Field id="pw" label="パスワード" required hint="8文字以上">
            <PasswordInput id="pw" isNew value={pw} onChange={setPw} invalid={!!error} />
          </Field>
          <Field id="pw2" label="もう一度" required error={error ?? undefined}>
            <PasswordInput id="pw2" autoComplete="new-password" value={pw2} onChange={setPw2} invalid={!!error} />
          </Field>
          <Button variant="primary" size="lg" block type="submit" disabled={busy} iconEnd={ArrowRight}>
            {busy ? '設定中…' : 'パスワードを設定して次へ'}
          </Button>
        </Panel>
      )}

      {phase === 'ready' && isAdmin && (
        <Panel as="section" roomy className={s.panel}>
          <p className={s.kicker}>
            <CheckCircle size={20} weight="fill" aria-hidden focusable="false" />
            準備ができました
          </p>
          <h1 className={s.title}>運営の画面を使えます</h1>
          <p className={s.text}>
            次回からは、運営の画面でメールアドレスとパスワードでログインしてください。「運営メンバー」のタブで、Google・Yahoo! JAPAN ID との連携もできます。
          </p>
          <ButtonLink href="/admin" variant="primary" size="lg" block iconEnd={ArrowRight}>
            運営の画面へ進む
          </ButtonLink>
        </Panel>
      )}

      {phase === 'ready' && !isAdmin && (
        <Panel as="section" roomy className={s.panel}>
          <p className={s.kicker}>
            <CheckCircle size={20} weight="fill" aria-hidden focusable="false" />
            登録が完了しました
          </p>
          <h1 className={s.title}>{salonName ? `${salonName} 様` : 'ようこそ'}</h1>
          <p className={s.text}>
            掲載が承認され、サロンの画面にログインしました。次回からは、ご登録のメールアドレスとパスワードでログインできます。
          </p>
          <p className={s.text}>
            続けて、3つの初期設定（メニューと価格・担当・お店の場所など）を行ってください。数分で終わります。設定が終わると、空いた時間を枠として公開できます。
          </p>
          <ol className={s.steps}>
            <li>メニューと価格・受付の締切</li>
            <li>担当</li>
            <li>お店の場所・受け付ける性別・LINE の連絡先</li>
          </ol>
          <ButtonLink href="/salon" variant="primary" size="lg" block iconEnd={ArrowRight}>
            サロンの画面へ進む
          </ButtonLink>
        </Panel>
      )}
    </Page>
  );
}
