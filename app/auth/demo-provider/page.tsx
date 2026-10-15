import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import DemoProvider from '@/components/auth/DemoProvider';
import { isProviderId, providerState } from '@/lib/server/oauth';

export const metadata: Metadata = { title: 'デモ用の認証画面', robots: { index: false } };
export const dynamic = 'force-dynamic';

// デモ用の認証画面：DEMO_MODE=true で、その外部 ID のキーが未設定のときだけ開ける
export default async function DemoProviderPage({ searchParams }: { searchParams: Promise<{ provider?: string }> }) {
  const { provider } = await searchParams;
  if (!isProviderId(provider) || providerState(provider) !== 'simulated') notFound();
  return <DemoProvider provider={provider} />;
}
