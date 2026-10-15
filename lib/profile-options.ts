// 登録・マイページで使う選択肢（データベースの制約と同じ値）

export const GENDERS = [
  { value: 'female', label: '女性' },
  { value: 'male', label: '男性' },
] as const;

export const AGE_GROUPS = [
  { value: '18-19', label: '18〜19歳' },
  { value: '20s', label: '20代' },
  { value: '30s', label: '30代' },
  { value: '40s', label: '40代' },
  { value: '50s', label: '50代' },
  { value: '60+', label: '60代以上' },
] as const;

export const OCCUPATIONS = [
  '会社員',
  '公務員',
  '自営業',
  'フリーランス',
  'パート・アルバイト',
  '学生',
  '主婦・主夫',
  'その他',
] as const;

export const CONVERSATION_PREFS = [
  { value: 'quiet', label: '静かに過ごしたい' },
  { value: 'talk', label: 'おしゃべりしたい' },
  { value: 'either', label: 'どちらでもよい' },
] as const;

export function label<T extends { value: string; label: string }>(list: readonly T[], value: string | null | undefined) {
  return list.find((o) => o.value === value)?.label ?? '';
}

// 規約の版（仮置き。公開中の利用規約・プライバシーポリシーの版に合わせて書き換える）
export const TERMS_VERSION = 'demo-1';
export const TERMS_URL = process.env.NEXT_PUBLIC_TERMS_URL || '/legal';
export const PRIVACY_URL = process.env.NEXT_PUBLIC_PRIVACY_URL || '/legal';
