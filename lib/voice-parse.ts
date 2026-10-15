// 「話しかけて探す」（プレビュー）：話した言葉から、時間帯とメニューをルールで読み取る（外部の AI は使わない）
import type { WindowKey } from './time';

export type VoiceQuery = { window: WindowKey; menu: string | null; nearStation: boolean; matched: string[] };

const WINDOW_RULES: { re: RegExp; key: WindowKey; label: string }[] = [
  { re: /(今すぐ|いますぐ|すぐ|30分|三十分|さんじゅっぷん)/, key: 'now', label: '今すぐ（30分以内）' },
  { re: /(1時間|一時間|いちじかん|60分|1時間以内)/, key: '1h', label: '1時間以内' },
  { re: /(2時間|二時間|3時間|三時間|さんじかん|夕方)/, key: '3h', label: '3時間以内' },
  { re: /(今日|きょう|今晩|今夜|夜)/, key: 'today', label: '今日中' },
];

const MENU_RULES: { re: RegExp; word: string }[] = [
  { re: /(前髪|まえがみ)/, word: '前髪' },
  { re: /(カラー|染め|そめ)/, word: 'カラー' },
  { re: /(カット|切り|きり|散髪)/, word: 'カット' },
];

export function parseVoice(text: string): VoiceQuery {
  const t = text.replace(/\s/g, '');
  const matched: string[] = [];
  const w = WINDOW_RULES.find((r) => r.re.test(t));
  if (w) matched.push(w.label);
  const m = MENU_RULES.find((r) => r.re.test(t));
  if (m) matched.push(m.word);
  const nearStation = /(駅|えき)/.test(t);
  if (nearStation) matched.push('駅の近く');
  return { window: w?.key ?? '1h', menu: m?.word ?? null, nearStation, matched };
}
