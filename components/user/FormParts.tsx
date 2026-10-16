'use client';

// 登録の画面で共通に使う部品
//   Field：入力欄の枠（ラベルは常に上、エラーは入力欄のすぐ下）
//   Choices：ボタンで選ぶ選択肢（選択肢が少ないもの）
//   MiniSteps：何段階目かを1行で示す
//   ProfileFields：予約に必要な情報（新規登録の2段階目と、外部 ID で登録したあとの仕上げで共通）
//     1画面に収まるよう、選択肢の多い項目はリストから選ぶ形にし、説明は1行にまとめる

import type { ReactNode } from 'react';
import { Field as FormField, Input, Select, formClass } from '@/components/ui/Form';
import { WarningCircle } from '@/components/ui/icons';
import { AGE_GROUPS, GENDERS, OCCUPATIONS, PRIVACY_URL, TERMS_URL } from '@/lib/profile-options';
import s from './FormParts.module.css';

export function Field({ id, label, required, error, hint, children }: { id: string; label: string; required?: boolean; error?: string; hint?: string; children: ReactNode }) {
  return (
    <FormField id={id} label={label} required={required} error={error} hint={hint} className={s.field}>
      {children}
    </FormField>
  );
}

export function Choices({ id, options, value, onChange }: { id: string; options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div id={id} tabIndex={-1} className={s.choices} role="radiogroup" aria-labelledby={`${id}-label`}>
      {options.map((o) => (
        <button type="button" key={o.value} role="radio" aria-checked={value === o.value} className={formClass.choice} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function MiniSteps({ step, total, label }: { step: number; total: number; label: string }) {
  return (
    <div className={s.steps} aria-label={`${total}段階のうち${step}段階目：${label}`}>
      <span className={s.stepsText}>
        <b className={`num ${s.stepsNum}`}>
          {step}/{total}
        </b>
        {label}
      </span>
      <span className={s.stepsBar} aria-hidden>
        <i style={{ width: `${(step / total) * 100}%` }} />
      </span>
    </div>
  );
}

export type ProfileForm = { name: string; phone: string; gender: string; age: string; job: string; area: string; agree: boolean };
export type ProfileErrors = Partial<Record<keyof ProfileForm, string>>;
export const EMPTY_PROFILE: ProfileForm = { name: '', phone: '', gender: '', age: '', job: '', area: '', agree: false };

export function checkProfile(f: ProfileForm): ProfileErrors {
  const e: ProfileErrors = {};
  if (!f.name.trim()) e.name = 'お名前を入力してください。';
  if (!/^0\d{1,4}-?\d{1,4}-?\d{3,4}$/.test(f.phone.trim())) e.phone = '数字で入力してください（例：090-1234-5678）。';
  if (!f.gender) e.gender = '選んでください。';
  if (!f.age) e.age = '選んでください。';
  if (!f.job) e.job = '選んでください。';
  if (!f.area) e.area = '選んでください。';
  if (!f.agree) e.agree = 'ご利用は18歳以上の方で、規約に同意いただける場合に限ります。';
  return e;
}

export function ProfileFields({
  form,
  errors,
  onChange,
  areas,
}: {
  form: ProfileForm;
  errors: ProfileErrors;
  onChange: <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => void;
  areas: { id: string; name: string }[];
}) {
  return (
    <div className={s.fields}>
      <p className={s.note}>すべて必須です。お名前と電話番号はご予約したお店にだけ伝え、性別・年代・職業はお店に伝えません。</p>
      <Field id="name" label="お名前" error={errors.name}>
        <Input id="name" autoComplete="name" maxLength={60} value={form.name} aria-invalid={!!errors.name} onChange={(e) => onChange('name', e.target.value)} />
      </Field>
      <Field id="phone" label="電話番号" error={errors.phone}>
        <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="090-1234-5678" value={form.phone} aria-invalid={!!errors.phone} onChange={(e) => onChange('phone', e.target.value)} />
      </Field>
      <div className={s.row}>
        <Field id="gender" label="性別" error={errors.gender}>
          <Choices id="gender" options={[...GENDERS]} value={form.gender} onChange={(v) => onChange('gender', v)} />
        </Field>
        <Field id="age" label="年代" error={errors.age}>
          <Select id="age" value={form.age} aria-invalid={!!errors.age} onChange={(e) => onChange('age', e.target.value)}>
            <option value="">選択</option>
            {AGE_GROUPS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className={s.row}>
        <Field id="job" label="職業" error={errors.job}>
          <Select id="job" value={form.job} aria-invalid={!!errors.job} onChange={(e) => onChange('job', e.target.value)}>
            <option value="">選択</option>
            {OCCUPATIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="area" label="利用エリア" error={errors.area}>
          <Select id="area" value={form.area} aria-invalid={!!errors.area} onChange={(e) => onChange('area', e.target.value)}>
            <option value="">選択</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className={s.agree}>
        <label className={formClass.check}>
          <input id="agree" type="checkbox" checked={form.agree} onChange={(e) => onChange('agree', e.target.checked)} />
          <span>
            18歳以上で、
            <a href={TERMS_URL} target="_blank" rel="noreferrer">
              利用規約
            </a>
            と
            <a href={PRIVACY_URL} target="_blank" rel="noreferrer">
              プライバシーポリシー
            </a>
            に同意します
          </span>
        </label>
        {errors.agree && (
          <span className={formClass.error} role="alert">
            <WarningCircle size={20} aria-hidden focusable="false" />
            {errors.agree}
          </span>
        )}
      </div>
    </div>
  );
}
