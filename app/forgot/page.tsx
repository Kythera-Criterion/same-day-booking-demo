import type { Metadata } from 'next';
import ForgotPassword from '@/components/auth/ForgotPassword';

export const metadata: Metadata = { title: 'パスワードの再設定' };

export default async function ForgotPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const { role } = await searchParams;
  return <ForgotPassword role={role ?? 'user'} />;
}
