import { brandMarkImage } from '@/lib/brand-mark-image';

// サロンのタブレットで「ホーム画面に追加」したときのアイコン（180×180 の PNG）。サロンの印（空いた一切れを外へ出す）
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return brandMarkImage('salon');
}
