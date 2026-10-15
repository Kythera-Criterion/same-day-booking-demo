import type { Metadata } from 'next';
import ResetPassword from '@/components/auth/ResetPassword';

export const metadata: Metadata = { title: '新しいパスワード' };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const { role } = await searchParams;
  return <ResetPassword role={role ?? 'user'} />;
}
