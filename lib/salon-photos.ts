// デモ用の3店の写真（public/images/salons。出典とライセンスは public/images/CREDITS.md）。
// 写真は画面の表示だけに使い、データベースには持たない。写真のないお店は、店の印（アイコンと頭文字）を出す
//   card：一覧の正方形（1:1）／hero：予約の確認と予約確定の画面の上部（16:9）／subs：詳細で添える2枚（1:1）
// alt には写っている内容を書く（店名は表示する側で前に付ける）

export type SalonPhotoSet = {
  card: string;
  hero: string;
  alt: string;
  subs: { src: string; alt: string }[];
};

const SET = (key: string, alt: string, sub1: string, sub2: string): SalonPhotoSet => ({
  card: `/images/salons/${key}-main-square.webp`,
  hero: `/images/salons/${key}-main-wide.webp`,
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
    '大きな窓から光が入る、白い壁の明るい店内に並ぶスタイリングチェアとセット面',
    '白い壁を背景に、ブラシやはさみ、カラー用の刷毛を掲げる手',
    '白い枠の鏡が2つ並ぶ真っ白なセット面と、黒いスタイリングチェア',
  ),
  // atelier nagi：静か・木・生成り
  '22222222-2222-4222-8222-222222222222': SET(
    'nagi',
    '白いレンガの壁と窓辺のやわらかな光の中に置かれた、スタイリングチェアとワゴン',
    'オフホワイトの台に並べた木製のコーム',
    'コームで毛束を取り、はさみでカットする手元',
  ),
  // Salon Komorebi：木漏れ日・あたたかい
  '33333333-3333-4333-8333-333333333333': SET(
    'komorebi',
    '日差しと影が落ちるクリーム色の壁に、丸い鏡と木の天板のセット面',
    'ロングヘアの後ろ姿と、カールアイロンで髪を整えるスタイリストの手',
    '木のコームで長い髪をとかす手元',
  ),
};

export function salonPhotos(salonId: string | null | undefined): SalonPhotoSet | null {
  return salonId ? (SALON_PHOTOS[salonId] ?? null) : null;
}
