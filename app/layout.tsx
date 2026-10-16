import './styles/tokens.css';
import './styles/base.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Manrope, Zen_Kaku_Gothic_New } from 'next/font/google';
import NetworkBanner from '@/components/NetworkBanner';

// 文字：Zen Kaku Gothic New（日本語。細身で端正な形が「澄んだ・確か」に合う）
// 数字：Manrope（時刻・金額・予約番号。幾何学的で桁が読みやすい。tabular-nums で桁をそろえる）
// どちらも Google Fonts で公開されている SIL Open Font License のフォント
const zen = Zen_Kaku_Gothic_New({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
  variable: '--font-zen',
});

const manrope = Manrope({
  subsets: ['latin'],
  weight: ['500', '700', '800'],
  display: 'swap',
  variable: '--font-manrope',
});

export const metadata: Metadata = {
  title: { default: '当日予約デモ', template: '%s｜当日予約デモ' },
  description: '空いてしまった時間だけを、今から行きたい人へ届ける当日・直前専用のマッチング（デモ）',
  applicationName: '当日予約デモ',
  appleWebApp: { capable: true, title: '当日予約', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1f6f5c',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" className={`${zen.variable} ${manrope.variable}`}>
      <body>
        <a className="skip-link" href="#main">
          本文へ移動
        </a>
        <NetworkBanner />
        <div id="main">{children}</div>
      </body>
    </html>
  );
}
