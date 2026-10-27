import { useRouter } from 'expo-router';

import { MASCOT } from '@/components/ui/mascot';
import { StatusScreen } from '@/components/ui/status-screen';
import { translate as t } from '@/lib/i18n';

/**
 * 리딩 하위 화면에서 고른 대본이 없을 때 — pen StatusScreen/Empty(「대본이 없어요」 + 「내 대본으로」).
 * 「내 대본으로」는 replace 하면 탭 묶음이 하나 더 쌓여 뒤로가기가 엉뚱한 탭으로 가서, 이미 있는 리딩 탭까지 내려간다(SOMA-853).
 * 머리는 각 라우트의 Stack 머리를 쓰고, Stack 머리가 없는 화면(리딩 실행)만 `header`·`onBack`을 넘긴다.
 */
export function ReadingNoScript({ header, onBack }: { header?: string; onBack?: () => void }) {
  const router = useRouter();
  return (
    <StatusScreen
      kind="empty"
      mascot={MASCOT.coach}
      header={header}
      onBack={onBack}
      safeArea={!!onBack}
      title={t('reading.noScript')}
      body={t('reading.noScriptBody')}
      primary={{ label: t('reading.toMyScripts'), onPress: () => router.dismissTo('/reading') }}
    />
  );
}
