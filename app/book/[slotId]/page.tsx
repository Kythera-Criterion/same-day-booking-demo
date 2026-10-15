import BookConfirm from '@/components/user/BookConfirm';
export const metadata = { title: '予約の確認' };

export default async function BookPage({ params }: { params: Promise<{ slotId: string }> }) {
  const { slotId } = await params;
  return <BookConfirm slotId={slotId} />;
}
