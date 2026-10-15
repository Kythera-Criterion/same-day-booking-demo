import UserLogin from '@/components/user/UserLogin';
import { providerStates } from '@/lib/server/oauth';
export const metadata = { title: 'ログイン' };

// DEMO_MODE と外部の ID のキーを起動時の環境変数から読むため、毎回サーバーで描画する
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; verified?: string; auth_error?: string; logged_out?: string }>;
}) {
  const { next, verified, auth_error, logged_out } = await searchParams;
  return (
    <UserLogin
      next={next ?? '/'}
      verified={verified === '1'}
      demoMode={process.env.DEMO_MODE === 'true'}
      providers={providerStates()}
      authError={auth_error ?? null}
      loggedOut={logged_out === '1'}
    />
  );
}
