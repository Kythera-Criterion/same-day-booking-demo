import type { ReactNode } from 'react';

// 読み込み中・データなし・エラーの表示（すべての画面で同じ見た目にする）

export function Loading({ rows = 2, label = '読み込み中' }: { rows?: number; label?: string }) {
  return (
    <div className="skeleton-list" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}

export function Empty({ children, icon = '○' }: { children: ReactNode; icon?: string }) {
  return (
    <p className="state">
      <span className="state-icon" aria-hidden>
        {icon}
      </span>
      {children}
    </p>
  );
}

export function ErrorState({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div className="state state-error" role="alert">
      {children}
      {onRetry && (
        <div>
          <button className="btn btn-text" onClick={onRetry}>
            もう一度読み込む
          </button>
        </div>
      )}
    </div>
  );
}

export function NotConfigured() {
  return (
    <main className="app">
      <div className="card" style={{ marginTop: 24 }}>
        <h2 className="card-title">設定が必要です</h2>
        <p className="card-sub">.env.local に Supabase のURLとキーを設定してから、もう一度起動してください。</p>
      </div>
    </main>
  );
}
