// ブランドの印（ロゴ）の形。ヘッダー・デモ用の舞台・ブラウザのタブ・ホーム画面のアイコンで、同じ形を使う
//   共通：時計の輪と、右上の琥珀の一切れ（＝今日の空いた時間）
//   中の形を、ページの使い方に合わせて変える
//     お客様：針が、次の空き（琥珀の一切れ）を指す ─ 今から行ける時間を探す
//     サロン：空いた一切れを、時計から切り出して外へ出す ─ 空き時間を公開する
//     運営　：時計の中に棒グラフ ─ 実証の数字を見守る
// 線は 24 の正方形の中に、角の丸い 2.2 の線（20px で表示すると、約 1.8px。Phosphor の Bold に近い太さ）
// app/icon.svg・app/salon/icon.svg・app/admin/icon.svg（ブラウザのタブのアイコン）も、この形を写している

export type MarkKind = 'user' | 'salon' | 'admin';

export type MarkPath = {
  d: string;
  // ink：白（役割の色の四角の上）、accent：琥珀（空いた時間）
  tone: 'ink' | 'accent';
  // 塗る（形）か、線か
  fill?: boolean;
};

export const MARK_VIEWBOX = 24;
export const MARK_STROKE = 2.2;

// 時計の輪（右上の一切れの分をあける）
const RING = 'M20.37 13.48A8.5 8.5 0 1 1 10.52 3.63';
// 右上の一切れ（10〜80°）
const SLOT = 'M13.48 3.63A8.5 8.5 0 0 1 20.37 10.52';

export const MARK_PATHS: Record<MarkKind, MarkPath[]> = {
  user: [
    { d: RING, tone: 'ink' },
    { d: SLOT, tone: 'accent' },
    { d: 'M12 12L15.68 8.32', tone: 'ink' },
    { d: 'M11.1 12a0.9 0.9 0 1 0 1.8 0a0.9 0.9 0 1 0 -1.8 0', tone: 'ink', fill: true },
  ],
  salon: [
    { d: RING, tone: 'ink' },
    { d: 'M13.27 10.73L14.77 3.69A7.2 7.2 0 0 1 20.31 9.23Z', tone: 'accent', fill: true },
  ],
  admin: [
    { d: RING, tone: 'ink' },
    { d: SLOT, tone: 'accent' },
    { d: 'M8.75 15.5V12.5M12 15.5V10M15.25 15.5V7.5', tone: 'ink' },
  ],
};

// 画像を作るとき（ホーム画面のアイコン）だけに使う色。画面の CSS では tokens.css の
// --color-action（役割の色）と --color-mark-accent を使う
export const MARK_IMAGE_COLORS: Record<MarkKind | 'ink' | 'accent', string> = {
  user: '#1f6f5c',
  salon: '#2c5aa0',
  admin: '#5b3f99',
  ink: '#ffffff',
  accent: '#f0d19a',
};
