import AdminApp from '@/components/admin/AdminApp';

// DEMO_MODE を起動時の環境変数から読むため、毎回サーバーで描画する
export const dynamic = 'force-dynamic';

export default function AdminPage() {
  return <AdminApp demoMode={process.env.DEMO_MODE === 'true'} />;
}
