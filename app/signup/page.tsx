import Signup from '@/components/user/Signup';
import { providerStates } from '@/lib/server/oauth';
import { safePath } from '@/lib/oauth-shared';
export const metadata = { title: '新規登録' };

// 外部の ID のキーと DEMO_MODE を起動時の環境変数から読むため、毎回サーバーで描画する
export const dynamic = 'force-dynamic';

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ auth_error?: string; next?: string }> }) {
  const { auth_error, next } = await searchParams;
  return <Signup providers={providerStates()} authError={auth_error ?? null} next={safePath(next, '/')} />;
}
