'use client';

// 登録・ログインの最後の画面（確認メールのリンク、または Google・Yahoo! JAPAN ID から戻ってくる先）
//   1. 一度だけ使えるトークンで、その役割（利用者・サロン・運営）のログイン状態にする
//   2. 続きの画面へ進める
//      利用者：予約に必要な情報（お名前・電話番号・18歳以上の確認など）が足りなければ、入力の画面へ
//      サロン：お店の情報をまだ出していなければ、お店の情報の入力へ
//      運営  ：運営の画面へ

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import { Loading, NotConfigured } from '@/components/States';
import Button, { ButtonLink } from '@/components/ui/Button';
import { Page, Pair } from '@/components/ui/Layout';
import { Panel, SectionHead, SubText } from '@/components/ui/Surface';
import { LinkIcon } from '@/components/ui/icons';
import s from './AuthComplete.module.css';
import { getClient, isConfigured, type Role } from '@/lib/supabase';
import { safePath } from '@/lib/oauth-shared';
import { notifyDesktop } from '@/lib/desktop-notify';

const ROLE_LABEL: Record<Role, string> = { user: '利用者', salon: 'サロン', admin: '運営' };
const ROLE_HOME: Record<Role, string> = { user: '/', salon: '/salon', admin: '/admin' };

export async function profileIncomplete(client: ReturnType<typeof getClient>, userId: string): Promise<boolean> {
  const { data } = await client.from('profiles').select('display_name,phone,adult_confirmed_at').eq('id', userId).maybeSingle();
  if (!data) return true;
  return !String(data.display_name ?? '').trim() || !String(data.phone ?? '').replace(/\D/g, '') || !data.adult_confirmed_at;
}

export default function AuthComplete({
  tokenHash,
  type,
  role: roleParam,
  next: nextParam,
  isNew,
}: {
  tokenHash: string | null;
  type: string | null;
  role: string | null;
  next: string | null;
  isNew: boolean;
}) {
  const router = useRouter();
  const role: Role = roleParam === 'salon' || roleParam === 'admin' ? roleParam : 'user';
  const next = safePath(nextParam, ROLE_HOME[role]);
  const [phase, setPhase] = useState<'checking' | 'invalid' | 'moving'>('checking');
  const started = useRef(false);
  // リンクを確かめられなかったが、この端末で別のアカウントがログインしているとき（そのアカウントで続けるかを選ぶ）
  const [other, setOther] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!isConfigured || (started.current && retry === 0)) return;
    started.current = true;
    (async () => {
      const client = getClient(role);
      let session = null;
      const useToken = retry === 0 && !!tokenHash && (type === 'magiclink' || type === 'signup');
      if (useToken) {
        const { data } = await client.auth.verifyOtp({ token_hash: tokenHash!, type: type as 'magiclink' | 'signup' });
        session = data.session;
        // トークンを URL に残さない
        window.history.replaceState(null, '', '/auth/complete');
        // 新規登録の確認が済んだ：パソコンに通知する（登録のときに許可されていれば）
        if (session && type === 'signup') notifyDesktop('ご登録が完了しました', 'アカウントが使えるようになりました。今日の空きから、すぐに予約できます。', 'signup');
        if (!session) {
          // 期限切れ・使用済みのリンク：この端末でログインしているアカウントがあっても、黙ってそのアカウントで進めない
          setOther((await client.auth.getSession()).data.session?.user.email ?? null);
          setPhase('invalid');
          return;
        }
      } else {
        // 読み直した場合・「ログイン中のアカウントで続ける」を選んだ場合
        session = (await client.auth.getSession()).data.session;
        if (!session) {
          setPhase('invalid');
          return;
        }
      }
      setPhase('moving');
      if (role === 'user') {
        const incomplete = await profileIncomplete(client, session.user.id);
        router.replace(incomplete ? `/signup/complete?next=${encodeURIComponent(next)}${isNew ? '&new=1' : ''}` : next);
        return;
      }
      if (role === 'salon') {
        const { data: member } = await client.from('salon_members').select('salon_id').eq('user_id', session.user.id).limit(1).maybeSingle();
        // 新規登録の画面から来たときは、スタッフになっているお店があっても、別のお店の申し込みへ進める
        router.replace(member ? next : '/salon/signup');
        return;
      }
      router.replace(next);
    })();
  }, [tokenHash, type, role, next, isNew, router, retry]);

  if (!isConfigured) return <NotConfigured />;

  return (
    <Page>
      <AppHeader role={ROLE_LABEL[role]} home={ROLE_HOME[role]} />
      {phase !== 'invalid' ? (
        <div className={s.checking}>
          <p className={s.status}>{phase === 'checking' ? '確認しています…' : 'ログインしました。移動しています…'}</p>
          <Loading rows={2} />
        </div>
      ) : (
        <Panel as="section" className={s.invalid}>
          <SectionHead icon={LinkIcon} title="このリンクは使えません" as="p" />
          <SubText>
            有効期限が切れたか、すでに使われたリンクです。登録の確認がまだの場合は、登録の画面から確認メールをもう一度お送りください。確認が済んでいる場合は、ログインしてください。
          </SubText>
          <Pair>
            <ButtonLink variant="quiet" size="md" href={role === 'salon' ? '/salon/signup' : role === 'admin' ? '/admin' : '/signup'}>
              {role === 'admin' ? '運営の画面へ' : '登録の画面へ'}
            </ButtonLink>
            <ButtonLink variant="primary" size="md" href={role === 'user' ? '/login' : ROLE_HOME[role]}>
              ログインへ
            </ButtonLink>
          </Pair>
          {other && (
            <Button
              variant="text"
              block
              className={s.other}
              onClick={() => {
                setOther(null);
                setPhase('checking');
                setRetry((n) => n + 1);
              }}
            >
              ログイン中のアカウント（{other}）で続ける
            </Button>
          )}
        </Panel>
      )}
    </Page>
  );
}
