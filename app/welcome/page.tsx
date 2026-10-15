import type { Metadata } from 'next';
import Welcome from '@/components/auth/Welcome';

export const metadata: Metadata = { title: 'ご利用開始' };
export const dynamic = 'force-dynamic';

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string; role?: string }> }) {
  const { token_hash, type, role } = await searchParams;
  return <Welcome tokenHash={token_hash ?? null} type={type ?? null} role={role ?? null} />;
}
