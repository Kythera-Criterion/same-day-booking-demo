'use client';

// 予期しないエラーのときの画面（真っ白な画面にしない）
import { useEffect } from 'react';
import Button, { ButtonLink } from '@/components/ui/Button';
import { Page, Pair } from '@/components/ui/Layout';
import { Panel, SectionHead, SubText } from '@/components/ui/Surface';
import { WarningCircle } from '@/components/ui/icons';
import s from './error.module.css';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Page className={s.page}>
      <Panel as="section">
        <SectionHead icon={WarningCircle} title="うまく表示できませんでした" as="p" />
        <SubText>
          通信が不安定か、一時的な不具合の可能性があります。もう一度お試しください。ご予約の内容は、そのまま残っています。
        </SubText>
        <Pair>
          <ButtonLink href="/" variant="quiet" size="md">
            ホームへ
          </ButtonLink>
          <Button variant="primary" size="md" onClick={reset}>
            もう一度表示する
          </Button>
        </Pair>
        {error.digest && (
          <p className={s.digest}>
            お問い合わせのときは、この番号をお伝えください：<span className="num">{error.digest}</span>
          </p>
        )}
      </Panel>
    </Page>
  );
}
