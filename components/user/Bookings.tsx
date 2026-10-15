'use client';

// 「予約」タブ：ご予約中の枠と、これまでの予約

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import { ErrorState, Loading, NotConfigured } from '@/components/States';
import { useRoleSession } from '@/lib/supabase';
import { AFTER_LOGOUT } from '@/lib/logout';
import { ActiveCard, HistoryList, NoActive } from './BookingsList';
import TabBar from './TabBar';
import { useUserState } from './useUserState';

export default function Bookings() {
  const router = useRouter();
  const { client, session, ready, signedOut } = useRoleSession('user');
  const { bookings, active, loaded, error, reload } = useUserState(client, session);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (ready && !session) router.replace(signedOut ? AFTER_LOGOUT.user : '/login?next=/bookings');
  }, [ready, session, signedOut, router]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!client) return <NotConfigured />;
  const history = bookings.filter((b) => b.id !== active?.id);

  return (
    <main className="app">
      <AppHeader role="利用者" />
      <h1 className="screen-title">予約</h1>
      {error && <ErrorState onRetry={reload}>{error}</ErrorState>}
      {!loaded && <Loading rows={3} />}
      {loaded && (
        <div className="stack">
          <h2 className="section-title">ご予約中</h2>
          {active && active.slot ? <ActiveCard booking={active} now={now} /> : <NoActive />}
          <h2 className="section-title">これまでの予約</h2>
          <HistoryList bookings={history} />
          <p className="fine-print">変更・キャンセルは、アプリからはできません。お店へ直接お電話ください。</p>
        </div>
      )}
      <TabBar hasActive={!!active} />
    </main>
  );
}
