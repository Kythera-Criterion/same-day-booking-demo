import { brandMarkImage } from '@/lib/brand-mark-image';

// 掲載の相談・申し込み（サロン向け）のページを「ホーム画面に追加」したときのアイコン。サロンの印
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return brandMarkImage('salon');
}
