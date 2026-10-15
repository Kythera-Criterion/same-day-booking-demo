import type { MetadataRoute } from 'next';

// スマートフォンの「ホーム画面に追加」で、アプリのように開けるようにする
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '当日予約デモ',
    short_name: '当日予約',
    description: '今日の空き時間だけを、今から行きたい人へ。',
    start_url: '/',
    display: 'standalone',
    background_color: '#f5f3ee',
    theme_color: '#1f6f5c',
    lang: 'ja',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
