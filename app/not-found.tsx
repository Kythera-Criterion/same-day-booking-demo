import AppHeader from '@/components/AppHeader';
import { ButtonLink } from '@/components/ui/Button';
import { Page } from '@/components/ui/Layout';
import { Panel, SectionHead, SubText } from '@/components/ui/Surface';
import { Lightning, MagnifyingGlass } from '@/components/ui/icons';
import s from './not-found.module.css';

export const metadata = { title: 'ページが見つかりません' };

export default function NotFound() {
  return (
    <Page>
      <AppHeader />
      <Panel as="section" className={s.panel}>
        <SectionHead icon={MagnifyingGlass} title="ページが見つかりません" as="p" />
        <SubText>URL が変わったか、受付を終えた予約・枠のページかもしれません。</SubText>
        <ButtonLink href="/" variant="primary" size="md" block icon={Lightning} iconWeight="duotone">
          今から行けるお店を探す
        </ButtonLink>
      </Panel>
    </Page>
  );
}
