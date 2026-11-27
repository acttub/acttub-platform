import { ReportPage } from '@/components/report-page';
import { COMMUNITY_REPORT_REASONS, REPORT_DETAIL_MAX, type CommunityReportReason } from '@/lib/community';
import { translate as t } from '@/lib/i18n';

/**
 * 게시판 글·댓글 신고 — 챌린지 신고와 같은 ReportPage 틀이다(아래 시트 금지).
 * 사유는 게시판 서버 계약(spam·abuse·sexual·privacy·other)이고, 기타를 고르면 설명(500자, 선택)을 받는다.
 * `busy` 동안은 「신고하는 중…」으로 막는다. 설명은 앞뒤 공백을 빼고 보낸다.
 */
export function CommunityReportPage({
  visible,
  target,
  busy,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  /** 'conversation' 은 1:1 메시지 대화방의 신고다(SOMA-1039). 사유·틀은 같다. */
  target: 'post' | 'comment' | 'conversation';
  busy?: boolean;
  onClose: () => void;
  onSubmit: (reason: CommunityReportReason, detail: string) => void;
}) {
  return (
    <ReportPage
      visible={visible}
      reasons={COMMUNITY_REPORT_REASONS}
      copy={{
        pageTitle: t('communityReport.pageTitle'),
        title:
          target === 'post'
            ? t('communityReport.titlePost')
            : target === 'conversation'
              ? t('communityReport.titleConversation')
              : t('communityReport.titleComment'),
        subtitle: t('communityReport.subtitle'),
        close: t('common.close'),
        reason: (value) => t(`communityReport.${value}`),
        noteLabel: t('communityReport.detailLabel'),
        counter: (count, max) => t('communityReport.counter', { count, max }),
        submit: t('communityReport.submit'),
        submitting: t('communityReport.submitting'),
      }}
      noteMax={REPORT_DETAIL_MAX}
      busy={busy}
      phLabels={{ close: 'community_report_close', submit: 'community_report_submit' }}
      onClose={onClose}
      onSubmit={(reason, detail) => onSubmit(reason, detail.trim())}
    />
  );
}
