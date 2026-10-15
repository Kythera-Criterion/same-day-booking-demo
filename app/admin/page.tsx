import AdminApp from '@/components/admin/AdminApp';
import { providerStates } from '@/lib/server/oauth';
export const metadata = { title: '運営' };

// DEMO_MODE と外部の ID のキーを起動時の環境変数から読むため、毎回サーバーで描画する
export const dynamic = 'force-dynamic';

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ auth_error?: string; linked?: string; tab?: string }> }) {
  const { auth_error, linked, tab } = await searchParams;
  return (
    <AdminApp
      demoMode={process.env.DEMO_MODE === 'true'}
      providers={providerStates()}
      authError={auth_error ?? null}
      linked={linked ?? null}
      initialTab={tab ?? null}
    />
  );
}
