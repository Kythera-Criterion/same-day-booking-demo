// 見た目の土台：デジタル庁デザインシステムの基本トークン（MIT License / Copyright (c) 2023 デジタル庁）→
// このサービスのトークン（基本・意味）→ 土台 → 共通の部品 → 画面ごとの部品（さらに細かい部品は CSS Modules）
import '@digital-go-jp/design-tokens/dist/tokens.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/user.css';
import './styles/salon.css';
import './styles/admin.css';
import './styles/demo.css';
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

// iPhone の画面の下部まで使い、下部の余白は env(safe-area-inset-bottom) で空ける
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
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
