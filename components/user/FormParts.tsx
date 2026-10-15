'use client';

// 登録の画面で共通に使う、入力欄の枠（ラベルは常に上、エラーは入力欄のすぐ下）と、ボタンで選ぶ選択肢

import type { ReactNode } from 'react';

export function Field({ id, label, required, error, hint, children }: { id: string; label: string; required?: boolean; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label className="field-label" htmlFor={id} id={`${id}-label`}>
        {label}
        {required && <span className="req">必須</span>}
      </label>
      {children}
      {hint && !error && <span className="field-hint" id={`${id}-hint`}>{hint}</span>}
      {error && (
        <span className="field-error" id={`${id}-error`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function Choices({ id, options, value, onChange }: { id: string; options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div id={id} tabIndex={-1} className="choice-row" role="radiogroup" aria-labelledby={`${id}-label`}>
      {options.map((o) => (
        <button type="button" key={o.value} role="radio" aria-checked={value === o.value} className="choice" onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
