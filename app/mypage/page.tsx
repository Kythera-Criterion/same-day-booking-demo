import MyPage from '@/components/user/MyPage';
import { providerStates } from '@/lib/server/oauth';
export const metadata = { title: 'マイページ' };

// 外部の ID のキーを起動時の環境変数から読むため、毎回サーバーで描画する
export const dynamic = 'force-dynamic';

export default async function MyPageRoute({ searchParams }: { searchParams: Promise<{ linked?: string; auth_error?: string }> }) {
  const { linked, auth_error } = await searchParams;
  return <MyPage providers={providerStates()} linked={linked ?? null} authError={auth_error ?? null} />;
}
