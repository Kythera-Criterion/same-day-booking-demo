// 「話しかけて探す」（プレビュー）：話した言葉から、時間帯とメニューをルールで読み取る（外部の AI は使わない）
// 時間帯は、具体的な長さ（「1時間30分」「45分」など）を先に読み、なければ言葉（「今すぐ」「夕方」「今日」）で決める
import type { WindowKey } from './time';

export type VoiceQuery = { window: WindowKey; menu: string | null; nearStation: boolean; matched: string[] };

const WINDOW_LABEL: Record<WindowKey, string> = {
  now: '今すぐ（30分以内）',
  '1h': '1時間以内',
  '3h': '3時間以内',
  today: '今日中',
};

const KANJI: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: 0.5 };
function num(s: string | undefined): number {
  if (!s) return 0;
  if (/^\d+$/.test(s)) return Number(s);
  if (s === '三十') return 30;
  if (s === '四十五') return 45;
  if (s === '十五') return 15;
  return KANJI[s] ?? 0;
}

// 「1時間30分」「2時間半」「45分」などを分に直す（なければ null）
function minutesOf(t: string): number | null {
  const m = /([0-9]+|[一二三四五六七八九十])\s*時間(半|([0-9]+|三十|四十五|十五)\s*分)?/.exec(t);
  if (m) return num(m[1]) * 60 + (m[2] === '半' ? 30 : num(m[3]));
  const n = /([0-9]+|三十|四十五|十五)\s*分/.exec(t);
  if (n) return num(n[1]);
  if (/(いちじかん)/.test(t)) return 60;
  if (/(さんじゅっぷん)/.test(t)) return 30;
  return null;
}

function windowFor(min: number): WindowKey {
  if (min <= 30) return 'now';
  if (min <= 60) return '1h';
  if (min <= 180) return '3h';
  return 'today';
}

const MENU_RULES: { re: RegExp; word: string }[] = [
  { re: /(前髪|まえがみ)/, word: '前髪' },
  { re: /(カラー|染め|そめ)/, word: 'カラー' },
  { re: /(カット|切り|きり|散髪)/, word: 'カット' },
];

export function parseVoice(text: string): VoiceQuery {
  const t = text.replace(/\s/g, '');
  const matched: string[] = [];
  const min = minutesOf(t);
  let w: WindowKey | null = min !== null && min > 0 ? windowFor(min) : null;
  if (!w) {
    if (/(今すぐ|いますぐ|今から)/.test(t)) w = 'now';
    else if (/(夕方|ゆうがた)/.test(t)) w = '3h';
    else if (/(今日|きょう|今晩|今夜|夜)/.test(t)) w = 'today';
  }
  if (w) matched.push(WINDOW_LABEL[w]);
  const m = MENU_RULES.find((r) => r.re.test(t));
  if (m) matched.push(m.word);
  // 駅の近さは、まだ検索の条件にできないため、読み取った内容には出さない（距離の近い順で表示する）
  const nearStation = /(駅|えき)/.test(t);
  return { window: w ?? '1h', menu: m?.word ?? null, nearStation, matched };
}
