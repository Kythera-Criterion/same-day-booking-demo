import { brandMarkImage } from '@/lib/brand-mark-image';

// iPhone の「ホーム画面に追加」用のアイコン（180×180 の PNG）。お客様の印（針が次の空きを指す）
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return brandMarkImage('user');
}
