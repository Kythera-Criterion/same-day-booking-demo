import type { ReactNode } from 'react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import Button from '@/components/ui/Button';
import Notice from '@/components/ui/Notice';
import { Page } from '@/components/ui/Layout';
import { Panel, SectionHead, SubText } from '@/components/ui/Surface';
import { ArrowsClockwise, Leaf, WarningCircle } from '@/components/ui/icons';
import s from './States.module.css';

// 読み込み中・データなし・エラーの表示（すべての画面で同じ見た目にする）

export function Loading({ rows = 2, label = '読み込み中' }: { rows?: number; label?: string }) {
  return (
    <div className={s.skeleton} aria-busy="true" aria-label={label} role="status">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}

export function Empty({ children, icon = Leaf }: { children: ReactNode; icon?: PhosphorIcon }) {
  const Glyph = icon;
  return (
    <p className={s.empty}>
      <Glyph size={24} aria-hidden focusable="false" />
      <span>{children}</span>
    </p>
  );
}

export function ErrorState({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <Notice tone="danger" role="alert" icon={WarningCircle}>
      <div className={s.error}>
        <span>{children}</span>
        {onRetry && (
          <Button variant="text" size="sm" icon={ArrowsClockwise} onClick={onRetry}>
            もう一度読み込む
          </Button>
        )}
      </div>
    </Notice>
  );
}

export function NotConfigured() {
  return (
    <Page>
      <Panel className={s.config}>
        <SectionHead title="設定が必要です" />
        <SubText>.env.local に Supabase のURLとキーを設定してから、もう一度起動してください。</SubText>
      </Panel>
    </Page>
  );
}
