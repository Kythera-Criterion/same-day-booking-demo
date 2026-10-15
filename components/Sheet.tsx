'use client';

// 画面の下から出るシート（共通）。
//   ・Esc キー・背景のタップ・「閉じる」で閉じる
//   ・開いている間は背景をスクロールさせない
//   ・開いたらシートの中にフォーカスを移し、Tab キーでシートの外へ出ない。閉じたら元の場所へ戻す

import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Sheet({
  label,
  title,
  onClose,
  narrow = false,
  role = 'dialog',
  children,
}: {
  label: string;
  title?: ReactNode;
  onClose: () => void;
  narrow?: boolean;
  role?: 'dialog' | 'alertdialog';
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const body = document.body;
    const prevOverflow = body.style.overflow;
    body.style.overflow = 'hidden';

    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus({ preventScroll: true });

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      body.style.overflow = prevOverflow;
      before?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section
        ref={panel}
        className={`sheet ${narrow ? 'sheet-narrow' : ''}`}
        role={role}
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grip" aria-hidden />
        {title !== undefined && (
          <div className="sheet-head">
            <h2 className="card-title">{title}</h2>
            <button type="button" className="btn btn-text" onClick={onClose}>
              閉じる
            </button>
          </div>
        )}
        {children}
      </section>
    </div>
  );
}
