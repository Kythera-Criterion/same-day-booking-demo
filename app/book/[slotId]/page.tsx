import BookConfirm from '@/components/user/BookConfirm';

export default async function BookPage({ params }: { params: Promise<{ slotId: string }> }) {
  const { slotId } = await params;
  return <BookConfirm slotId={slotId} />;
}
