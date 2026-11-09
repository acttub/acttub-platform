import { ReportPage } from '@/components/report-page';
import { REPORT_REASONS } from '@/lib/challenge/moderation';
import { REPORT_NOTE_MAX, type ReportReason, type ReportTarget } from '@/lib/challenge/types';
import { translate as t } from '@/lib/i18n';

/**
 * A15.4 신고(challenge.report) — 참여작·댓글·챌린지를 사유와 함께 신고한다. 틀은 ReportPage(전체 화면 페이지)다.
 * 사유 다섯 개를 각각 선택지로 두고, 기타를 고르면 메모(200자, 선택)를 받는다. 참여작·댓글은
 * 접수 즉시 숨겨지고 챌린지는 신고가 쌓이면 운영이 본다 — 안내 문구가 다르다.
 */
export function ChallengeReportSheet({
  visible,
  target,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  target: ReportTarget;
  onClose: () => void;
  onSubmit: (reason: ReportReason, note: string) => void;
}) {
  const title =
    target === 'comment'
      ? t('videoReport.titleComment')
      : target === 'challenge'
        ? t('videoReport.titleChallenge')
        : t('videoReport.title');
  return (
    <ReportPage
      visible={visible}
      reasons={REPORT_REASONS}
      copy={{
        pageTitle: t('videoReport.pageTitle'),
        title,
        subtitle: t('videoReport.subtitle'),
        close: t('videoReport.close'),
        reason: (value) => t(`videoReport.${value}`),
        noteLabel: t('videoReport.noteLabel'),
        counter: (count, max) => t('videoReport.noteCounter', { count, max }),
        submit: t('videoReport.submit'),
      }}
      noteMax={REPORT_NOTE_MAX}
      phLabels={{ close: 'report_close', submit: 'report_submit' }}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  );
}
