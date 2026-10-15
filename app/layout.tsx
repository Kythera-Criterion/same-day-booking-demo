import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Noto_Sans_JP } from 'next/font/google';

const noto = Noto_Sans_JP({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
  variable: '--font-noto',
});

export const metadata: Metadata = {
  title: '当日予約デモ',
  description: '空いてしまった時間だけを、今から行きたい人へ届ける当日・直前専用のマッチング（デモ）',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1f6f5c',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" className={noto.variable}>
      <body>{children}</body>
    </html>
  );
}
