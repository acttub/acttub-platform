import { RatingBox } from '@/components/report-rating';
import { logEvent } from '@/lib/analytics';
import { translate as t } from '@/lib/i18n';
import { readingRatings } from '@/lib/reading-rating';
import { buildReadingRatingBody, READING_RATING_COMMENT_MAX, type ReadingRating as SavedRating, type ReadingRatingValue } from '@/lib/reading/session-rating';

/**
 * 리딩이 끝난 화면의 "이번 리딩 어땠나요?"(reading.session, SOMA-661). 칩을 누르는 순간 서버에 리딩 회차 단위로
 * 남기고, 못 보내면 기기가 들고 있다가 다시 보낸다(lib/reading-rating.ts). 노트 평가와 같은 상자를 쓴다.
 */
export function ReadingRating({
  sessionId,
  initial = null,
  onInputFocus,
}: {
  sessionId: string;
  initial?: SavedRating | null;
  onInputFocus?: () => void;
}) {
  return (
    <RatingBox<ReadingRatingValue>
      initial={initial}
      title={t('reading.rateTitle')}
      options={[
        ['good', 'thumbs-up', t('reading.rateGood')],
        ['bad', 'thumbs-down', t('reading.rateBad')],
      ]}
      placeholder={t('reading.ratePh')}
      sendLabel={t('report.rateSend')}
      thanks={t('reading.rateThanks')}
      commentMax={READING_RATING_COMMENT_MAX}
      onInputFocus={onInputFocus}
      save={async (requestId, rating, comment) => {
        const result = await readingRatings.send(sessionId, buildReadingRatingBody({ requestId, rating, comment }));
        void logEvent('reading_rating_submit', { rating, length: comment?.length ?? 0, result });
        return result;
      }}
    />
  );
}
