'use client';

// はじめて開いた人にだけ出す、3つの手順の説明（押す → 選ぶ → 行く）。
// 「わかった」で閉じると、この端末では次から出さない（端末の中にだけ覚える。読み書きできなくても動く）

import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import { HandTap, ListBullets, PersonSimpleWalk } from '@/components/ui/icons';
import s from './FirstSteps.module.css';

const KEY = 'first-steps-seen';

const STEPS = [
  { verb: '押す', desc: '探すボタンを押す', icon: HandTap },
  { verb: '選ぶ', desc: '候補から選ぶ', icon: ListBullets },
  { verb: '行く', desc: '予約番号を伝える', icon: PersonSimpleWalk },
];

export default function FirstSteps() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      setShow(localStorage.getItem(KEY) !== '1');
    } catch {
      setShow(true);
    }
  }, []);

  if (!show) return null;
  return (
    <section className={s.box} aria-labelledby="first-steps-title">
      <h2 className={s.title} id="first-steps-title">
        はじめての方へ：3つの手順
      </h2>
      <ol className={s.steps}>
        {STEPS.map((st) => (
          <li key={st.verb} className={s.step}>
            <span className={s.icon}>
              <st.icon size={24} weight="duotone" aria-hidden focusable="false" />
            </span>
            <span className={s.verb}>{st.verb}</span>
            <span className={s.desc}>{st.desc}</span>
          </li>
        ))}
      </ol>
      <Button
        variant="text"
        className={s.close}
        onClick={() => {
          setShow(false);
          try {
            localStorage.setItem(KEY, '1');
          } catch {
            // 覚えられなくても、閉じる
          }
        }}
      >
        わかった
      </Button>
    </section>
  );
}
