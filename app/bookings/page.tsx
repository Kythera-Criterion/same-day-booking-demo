import Bookings from '@/components/user/Bookings';

export const metadata = { title: '予約' };

// 下のタブの「予約」：現在の予約と、予約の履歴
export default function BookingsRoute() {
  return <Bookings />;
}
