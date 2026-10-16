import SalonSignup from '@/components/salon/SalonSignup';
import { providerStates } from '@/lib/server/oauth';
export const metadata = { title: 'サロンの新規登録' };

// 外部の ID のキーと DEMO_MODE を起動時の環境変数から読むため、毎回サーバーで描画する
export const dynamic = 'force-dynamic';

export default async function SalonSignupPage({ searchParams }: { searchParams: Promise<{ auth_error?: string }> }) {
  const { auth_error } = await searchParams;
  return <SalonSignup providers={providerStates()} authError={auth_error ?? null} demoMode={process.env.DEMO_MODE === 'true'} />;
}
