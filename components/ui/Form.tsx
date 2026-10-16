// 入力の部品：Field（ラベル・補足・エラー）・Input・Select・Textarea・Check・Choices・Segmented
//   入力欄そのものは素の要素に className を付けて使えるよう、クラス名も書き出す

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { WarningCircle } from './icons';
import s from './Form.module.css';

export const formClass = {
  input: s.input,
  textarea: `${s.input} ${s.textarea}`,
  choices: s.choices,
  choice: s.choice,
  choiceOn: s.choiceOn,
  choiceSub: s.choiceSub,
  row2: s.row2,
  check: s.check,
  field: s.field,
  label: s.label,
  hint: s.hint,
  error: s.error,
};

export function Field({
  id,
  label,
  required,
  error,
  hint,
  className,
  children,
}: {
  id?: string;
  label: ReactNode;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`${s.field} ${className ?? ''}`}>
      <label className={s.label} htmlFor={id} id={id ? `${id}-label` : undefined}>
        {label}
        {required && <span className={s.req}>必須</span>}
      </label>
      {children}
      {hint && !error && (
        <span className={s.hint} id={id ? `${id}-hint` : undefined}>
          {hint}
        </span>
      )}
      {error && (
        <span className={s.error} id={id ? `${id}-error` : undefined} role="alert">
          <WarningCircle size={20} aria-hidden focusable="false" />
          {error}
        </span>
      )}
    </div>
  );
}

// ラベルで包む形（入力欄がラベルの中にある）
export function LabeledField({ label, hint, className, children }: { label: ReactNode; hint?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <label className={`${s.field} ${className ?? ''}`}>
      <span className={s.label}>{label}</span>
      {children}
      {hint && <span className={s.hint}>{hint}</span>}
    </label>
  );
}

export function FieldRow({ children }: { children: ReactNode }) {
  return <div className={s.row2}>{children}</div>;
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${s.input} ${className ?? ''}`} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${s.input} ${className ?? ''}`} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${s.input} ${s.textarea} ${className ?? ''}`} {...rest} />;
}

export function Check({
  checked,
  onChange,
  id,
  disabled,
  className,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`${s.check} ${className ?? ''}`}>
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

export type SegmentOption<T extends string> = { value: T; label: ReactNode; count?: number | string; empty?: boolean };

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={`${s.segmented} ${className ?? ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={s.segment} aria-pressed={value === o.value} data-empty={o.empty ? 'true' : undefined} onClick={() => onChange(o.value)}>
          <span>{o.label}</span>
          {o.count !== undefined && <span className={s.segmentCount}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
