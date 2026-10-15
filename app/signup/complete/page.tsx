import type { Metadata } from 'next';
import ProfileComplete from '@/components/user/ProfileComplete';

export const metadata: Metadata = { title: '登録の仕上げ' };
export const dynamic = 'force-dynamic';

export default async function ProfileCompletePage({ searchParams }: { searchParams: Promise<{ next?: string; new?: string }> }) {
  const { next, new: isNew } = await searchParams;
  return <ProfileComplete next={next ?? null} isNew={isNew === '1'} />;
}
