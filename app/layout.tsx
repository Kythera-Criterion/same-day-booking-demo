import './styles/tokens.css';
import './styles/base.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { M_PLUS_2, Manrope, Shippori_Mincho } from 'next/font/google';
import NetworkBanner from '@/components/NetworkBanner';
import UsageTracker from '@/components/UsageTracker';

// 文字：M PLUS 2（日本語。字面が締まっていて、数字の欧文となじむ。太さを細かく選べる可変フォント）
// 数字：Manrope（時刻・金額・予約番号。幾何学的で桁が読みやすい。tabular-nums で桁をそろえる）
// どちらも Google Fonts で公開されている SIL Open Font License のフォント
const mplus = M_PLUS_2({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jp',
});

// 見出し：Shippori Mincho（お客様のホームの大きな見出し・店名。やわらかく上品な明朝）
const mincho = Shippori_Mincho({
  subsets: ['latin'],
  weight: ['500', '600'],
  display: 'swap',
  variable: '--font-mincho',
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

// ページの背景の「時刻の空」：日本時間の時刻から時間帯を決め、<html data-sky> に付ける（色は tokens.css）
//   描画の前に決めて、背景が切り替わってちらつかないようにする。開いたままでも1分ごとに付け直す
//   表示だけのためのもので、予約・表示の内容には関わらない
const SKY_SCRIPT = `(function(){function s(){var h=new Date(Date.now()+324e5).getUTCHours();document.documentElement.setAttribute('data-sky',h<5?'night':h<11?'morning':h<16?'noon':h<19?'dusk':'night')}s();setInterval(s,6e4)})()`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // data-sky は描画の前にスクリプトが付けるので、その差は読み込み時の不一致として扱わない
    <html lang="ja" className={`${mplus.variable} ${manrope.variable} ${mincho.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SKY_SCRIPT }} />
      </head>
      <body>
        <a className="skip-link" href="#main">
          本文へ移動
        </a>
        <NetworkBanner />
        <UsageTracker />
        <div id="main">{children}</div>
      </body>
    </html>
  );
}
