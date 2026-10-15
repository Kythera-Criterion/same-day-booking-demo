import type { Metadata } from 'next';
import AuthComplete from '@/components/auth/AuthComplete';

export const metadata: Metadata = { title: 'ログイン' };
export const dynamic = 'force-dynamic';

export default async function AuthCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; role?: string; next?: string; new?: string }>;
}) {
  const q = await searchParams;
  return <AuthComplete tokenHash={q.token_hash ?? null} type={q.type ?? null} role={q.role ?? null} next={q.next ?? null} isNew={q.new === '1'} />;
}
