'use client';

// 登録・ログインの最後の画面（確認メールのリンク、または Google・Yahoo! JAPAN ID から戻ってくる先）
//   1. 一度だけ使えるトークンで、その役割（利用者・サロン・運営）のログイン状態にする
//   2. 続きの画面へ進める
//      利用者：予約に必要な情報（お名前・電話番号・18歳以上の確認など）が足りなければ、入力の画面へ
//      サロン：お店の情報をまだ出していなければ、お店の情報の入力へ
//      運営  ：運営の画面へ

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import { Loading, NotConfigured } from '@/components/States';
import { getClient, isConfigured, type Role } from '@/lib/supabase';
import { safePath } from '@/lib/oauth-shared';

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

  useEffect(() => {
    if (!isConfigured || started.current) return;
    started.current = true;
    (async () => {
      const client = getClient(role);
      let session = null;
      if (tokenHash && (type === 'magiclink' || type === 'signup')) {
        const { data } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
        session = data.session;
      }
      // 同じリンクをもう一度開いた場合など：すでにログインしていれば、そのまま進める
      if (!session) session = (await client.auth.getSession()).data.session;
      // トークンを URL に残さない
      window.history.replaceState(null, '', '/auth/complete');
      if (!session) {
        setPhase('invalid');
        return;
      }
      setPhase('moving');
      if (role === 'user') {
        const incomplete = await profileIncomplete(client, session.user.id);
        router.replace(incomplete ? `/signup/complete?next=${encodeURIComponent(next)}${isNew ? '&new=1' : ''}` : next);
        return;
      }
      if (role === 'salon') {
        const { data: member } = await client.from('salon_members').select('salon_id').eq('user_id', session.user.id).limit(1).maybeSingle();
        router.replace(member ? (next.startsWith('/salon/signup') ? '/salon' : next) : '/salon/signup');
        return;
      }
      router.replace(next);
    })();
  }, [tokenHash, type, role, next, isNew, router]);

  if (!isConfigured) return <NotConfigured />;

  return (
    <main className="app">
      <AppHeader role={ROLE_LABEL[role]} home={ROLE_HOME[role]} />
      {phase !== 'invalid' ? (
        <>
          <p className="card-sub" style={{ textAlign: 'center', marginTop: 24 }}>
            {phase === 'checking' ? '確認しています…' : 'ログインしました。移動しています…'}
          </p>
          <Loading rows={2} />
        </>
      ) : (
        <section className="card fade-in" style={{ marginTop: 16 }}>
          <p className="card-title">このリンクは使えません</p>
          <p className="card-sub">
            有効期限が切れたか、すでに使われたリンクです。登録の確認がまだの場合は、登録の画面から確認メールをもう一度お送りください。確認が済んでいる場合は、ログインしてください。
          </p>
          <div className="action-pair">
            <Link className="btn btn-quiet" href={role === 'salon' ? '/salon/signup' : role === 'admin' ? '/admin' : '/signup'}>
              {role === 'admin' ? '運営の画面へ' : '登録の画面へ'}
            </Link>
            <Link className="btn btn-primary" href={role === 'user' ? '/login' : ROLE_HOME[role]}>
              ログインへ
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}
