import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Noto_Sans_JP } from 'next/font/google';
import NetworkBanner from '@/components/NetworkBanner';

const noto = Noto_Sans_JP({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
  variable: '--font-noto',
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
    <html lang="ja" className={noto.variable}>
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
