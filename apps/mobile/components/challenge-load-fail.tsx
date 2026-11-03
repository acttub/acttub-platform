import { StatusScreen } from '@/components/ui/status-screen';
import { canRetryBrowse, browseFailureMessage, type BrowseFailure } from '@/lib/challenge/browse';
import { translate as t } from '@/lib/i18n';

/** 챌린지 화면을 통째로 못 불러왔을 때 — 다시 시도할 수 있으면 다시 시도, 아니면 챌린지 탭으로 보낸다(StatusScreen/Error). */
export function ChallengeLoadFail({ failure, onRetry, onLeave }: { failure: BrowseFailure; onRetry: () => void; onLeave: () => void }) {
  return canRetryBrowse(failure) ? (
    <StatusScreen
      title={t('challenges.loadFailTitle')}
      body={failure.kind === 'offline' ? browseFailureMessage(failure) : t('challenges.loadFailSub')}
      primary={{ label: t('common.retry'), onPress: onRetry }}
    />
  ) : (
    <StatusScreen title={browseFailureMessage(failure)} primary={{ label: t('challenges.goneCta'), onPress: onLeave }} />
  );
}
