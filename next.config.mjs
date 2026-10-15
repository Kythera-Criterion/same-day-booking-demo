/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // デモ用の舞台（/demo）が同じサイトの画面を枠の中に表示するため、同じサイトからの埋め込みだけを許す
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  // 位置情報・マイク（話しかけて探す）・画面のスリープ防止は、このサイトの中だけで使う。カメラなどは使わない
  { key: 'Permissions-Policy', value: 'camera=(), payment=(), usb=(), geolocation=(self), microphone=(self), screen-wake-lock=(self)' },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
