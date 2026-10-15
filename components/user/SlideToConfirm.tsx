'use client';

// 「スライドして予約を確定」：押し間違いを防ぐための確定操作。
// キーボードや読み上げソフトでは、代わりに「長押しで確定」のボタンを使う（Enter / Space を押し続ける）

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

const HOLD_MS = 1200;

export default function SlideToConfirm({
  label,
  busy,
  disabled,
  onConfirm,
}: {
  label: string;
  busy: boolean;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const [drag, setDrag] = useState<{ startX: number; max: number } | null>(null);
  const [hold, setHold] = useState(0);
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const done = useRef(false);

  const off = disabled || busy;

  function fire() {
    if (done.current || off) return;
    done.current = true;
    onConfirm();
    setTimeout(() => {
      done.current = false;
      setX(0);
      setHold(0);
    }, 1500);
  }

  function down(e: PointerEvent<HTMLDivElement>) {
    if (off || !track.current) return;
    const thumb = e.currentTarget;
    thumb.setPointerCapture(e.pointerId);
    const max = track.current.clientWidth - thumb.clientWidth - 8;
    setDrag({ startX: e.clientX - x, max });
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    setX(Math.max(0, Math.min(drag.max, e.clientX - drag.startX)));
  }
  function up() {
    if (!drag) return;
    if (x >= drag.max * 0.92) {
      setX(drag.max);
      fire();
    } else {
      setX(0);
    }
    setDrag(null);
  }

  function startHold() {
    if (off || holdTimer.current) return;
    const t0 = Date.now();
    holdTimer.current = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / HOLD_MS);
      setHold(p);
      if (p >= 1) {
        stopHold(false);
        fire();
      }
    }, 30);
  }
  function stopHold(reset = true) {
    if (holdTimer.current) clearInterval(holdTimer.current);
    holdTimer.current = null;
    if (reset && !done.current) setHold(0);
  }
  function keyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
      e.preventDefault();
      startHold();
    }
  }

  return (
    <div className="confirm-ctl">
      <div ref={track} className={`slide ${off ? 'is-off' : ''}`} aria-hidden>
        <span className="slide-fill" style={{ width: x + 56 }} />
        <span className="slide-text">{busy ? '予約しています…' : label}</span>
        <div
          className="slide-thumb"
          style={{ transform: `translateX(${x}px)`, transition: drag ? 'none' : undefined }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        >
          →
        </div>
      </div>
      <button
        type="button"
        className="hold-btn"
        disabled={off}
        onPointerDown={startHold}
        onPointerUp={() => stopHold()}
        onPointerLeave={() => stopHold()}
        onKeyDown={keyDown}
        onKeyUp={() => stopHold()}
        onBlur={() => stopHold()}
      >
        <span className="hold-fill" style={{ width: `${hold * 100}%` }} aria-hidden />
        <span className="hold-text">または、ここを長押しで確定</span>
        <span className="sr-only">（{label}）</span>
      </button>
    </div>
  );
}
