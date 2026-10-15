import UserLogin from '@/components/user/UserLogin';

// DEMO_MODE を起動時の環境変数から読むため、毎回サーバーで描画する
export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; verified?: string }> }) {
  const { next, verified } = await searchParams;
  return <UserLogin next={next ?? '/'} verified={verified === '1'} demoMode={process.env.DEMO_MODE === 'true'} />;
}
