import { notFound } from 'next/navigation';
import DemoStage from '@/components/demo/DemoStage';
export const metadata = { title: 'デモ用の舞台' };

// DEMO_MODE=true のときだけ表示する（それ以外は404）
export const dynamic = 'force-dynamic';

export default function DemoPage() {
  if (process.env.DEMO_MODE !== 'true') notFound();
  return <DemoStage />;
}
