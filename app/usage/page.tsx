import UsageLog from '@/components/usage/UsageLog';
export const metadata = { title: '利用の記録' };

// 利用の記録：運営や各画面から独立した別のページ（どの画面からもリンクしない。URL を開いて使う）

// DEMO_MODE を起動時の環境変数から読むため、毎回サーバーで描画する
export const dynamic = 'force-dynamic';

export default function UsagePage() {
  return <UsageLog demoMode={process.env.DEMO_MODE === 'true'} />;
}
