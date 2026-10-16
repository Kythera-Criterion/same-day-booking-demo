'use client';

// パスワードの入力欄（「表示」で入力した文字を確かめられる）。新しく決めるときは、強さの目安も出す

import { useState, type InputHTMLAttributes } from 'react';
import { formClass } from '@/components/ui/Form';
import { Eye, EyeSlash } from '@/components/ui/icons';
import s from './PasswordInput.module.css';

export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (pw.length < 8) return { score: 0, label: '8文字以上にしてください' };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (pw.length >= 12 && kinds >= 3) return { score: 3, label: '強い' };
  if (pw.length >= 10 || kinds >= 3) return { score: 2, label: 'ふつう' };
  return { score: 1, label: '弱い（英字・数字・記号を混ぜると強くなります）' };
}

export default function PasswordInput({
  id,
  value,
  onChange,
  isNew = false,
  invalid,
  describedBy,
  ...rest
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  isNew?: boolean;
  invalid?: boolean;
  describedBy?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type' | 'id'>) {
  const [show, setShow] = useState(false);
  const strength = isNew && value ? passwordStrength(value) : null;
  return (
    <>
      <div className={s.wrap}>
        <input
          id={id}
          className={`${formClass.input} ${s.input}`}
          type={show ? 'text' : 'password'}
          autoComplete={isNew ? 'new-password' : 'current-password'}
          value={value}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
          {...rest}
        />
        <button type="button" className={s.toggle} aria-pressed={show} aria-controls={id} onClick={() => setShow((v) => !v)}>
          {show ? <EyeSlash size={20} aria-hidden focusable="false" /> : <Eye size={20} aria-hidden focusable="false" />}
          {show ? '隠す' : '表示'}
        </button>
      </div>
      {strength && (
        <span className={s.meter} data-score={strength.score} aria-live="polite">
          <span className={s.bars} aria-hidden>
            <i />
            <i />
            <i />
          </span>
          強さ：{strength.label}
        </span>
      )}
    </>
  );
}
