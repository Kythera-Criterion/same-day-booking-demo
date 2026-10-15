import BookingDetail from '@/components/user/BookingDetail';

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const { id } = await params;
  const { new: isNew } = await searchParams;
  return <BookingDetail bookingId={id} isNew={isNew === '1'} />;
}
