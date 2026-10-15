import { ImageResponse } from 'next/og';

// iPhone の「ホーム画面に追加」用のアイコン（180×180 の PNG を作る）
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#1f6f5c',
        }}
      >
        <div
          style={{
            width: 104,
            height: 104,
            borderRadius: 52,
            border: '12px solid #ffffff',
            position: 'relative',
            display: 'flex',
          }}
        >
          <div style={{ position: 'absolute', left: 34, top: 14, width: 12, height: 38, background: '#ffffff', borderRadius: 6 }} />
          <div
            style={{
              position: 'absolute',
              left: 38,
              top: 42,
              width: 34,
              height: 12,
              background: '#ffffff',
              borderRadius: 6,
              transform: 'rotate(35deg)',
              transformOrigin: 'left center',
            }}
          />
        </div>
      </div>
    ),
    size,
  );
}
