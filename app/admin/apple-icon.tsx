import { brandMarkImage } from '@/lib/brand-mark-image';

// 運営の画面を「ホーム画面に追加」したときのアイコン（180×180 の PNG）。運営の印（時計の中に棒グラフ）
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return brandMarkImage('admin');
}
