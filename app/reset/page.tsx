import type { Metadata } from 'next';
import ResetPassword from '@/components/auth/ResetPassword';

export const metadata: Metadata = { title: '新しいパスワード' };
export const dynamic = 'force-dynamic';

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ role?: string; token_hash?: string }> }) {
  const { role, token_hash } = await searchParams;
  return <ResetPassword role={role ?? 'user'} tokenHash={token_hash ?? null} />;
}
