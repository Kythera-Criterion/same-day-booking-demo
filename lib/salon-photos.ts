// デモ用の3店の写真（メインは public/images/home、サブは public/images/salons。出典とライセンスは public/images/CREDITS.md）。
// 写真は画面の表示だけに使い、データベースには持たない。写真のないお店は、店の印（アイコンと頭文字）を出す
//   main：お店のメインの写真（たて長）。ホームの「今すぐ行けるサロン」・候補の一覧・予約の確認と予約確定の画面の上部で、
//         同じ写真を枠に合わせて切り抜いて見せる（画面ごとにお店の写真が変わらないように）／subs：詳細で添える2枚（1:1）
// alt には写っている内容を書く（店名は表示する側で前に付ける）

export type SalonPhotoSet = {
  main: string;
  alt: string;
  subs: { src: string; alt: string }[];
};

const SET = (key: string, alt: string, sub1: string, sub2: string): SalonPhotoSet => ({
  main: `/images/home/salon-${key}.webp`,
  alt,
  subs: [
    { src: `/images/salons/${key}-sub1-square.webp`, alt: sub1 },
    { src: `/images/salons/${key}-sub2-square.webp`, alt: sub2 },
  ],
});

export const SALON_PHOTOS: Record<string, SalonPhotoSet> = {
  // HAIR ROOM AOI：澄んだ・明るい・白
  '11111111-1111-4111-8111-111111111111': SET(
    'aoi',
    '大きな窓と縦長の鏡が並ぶ明るい店内と、ベージュのスタイリングチェア',
    '白い壁を背景に、ブラシやはさみ、カラー用の刷毛を掲げる手',
    '白い枠の鏡が2つ並ぶ真っ白なセット面と、黒いスタイリングチェア',
  ),
  // atelier nagi：静か・木・生成り
  '22222222-2222-4222-8222-222222222222': SET(
    'nagi',
    '観葉植物と、小枝を生けた花瓶とボトルが並ぶ木の台、籐の椅子',
    'オフホワイトの台に並べた木製のコーム',
    'コームで毛束を取り、はさみでカットする手元',
  ),
  // Salon Komorebi：木漏れ日・あたたかい
  '33333333-3333-4333-8333-333333333333': SET(
    'komorebi',
    '日差しの落ちる白い壁に、金の縁の鏡と花・ボトルを並べた台',
    'ロングヘアの後ろ姿と、カールアイロンで髪を整えるスタイリストの手',
    '木のコームで長い髪をとかす手元',
  ),
};

export function salonPhotos(salonId: string | null | undefined): SalonPhotoSet | null {
  return salonId ? (SALON_PHOTOS[salonId] ?? null) : null;
}
