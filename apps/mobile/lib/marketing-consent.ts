import { translate } from './i18n.ts';

/** 광고성 정보 수신 동의 문서의 종류(account.consent 「데이터」). 전송 매체마다 따로 묻는다. */
export const MARKETING_CONSENT_TYPES = ['marketing_email', 'marketing_push'] as const;
export type MarketingConsentType = (typeof MARKETING_CONSENT_TYPES)[number];

export function isMarketingConsent(type: string | null | undefined): type is MarketingConsentType {
  return (MARKETING_CONSENT_TYPES as readonly string[]).includes(type ?? '');
}

export type MarketingDecision = { type: string; decision: 'granted' | 'declined' };

/** 'YYYY.MM.DD' — 기기 시간대 기준. */
function dayLabel(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, '0');
  const day = String(at.getDate()).padStart(2, '0');
  return `${at.getFullYear()}.${month}.${day}`;
}

/**
 * 광고성 정보 수신 동의·거부의 처리 결과 안내(정보통신망법 제50조 제7항). 보내는 곳(Acttub), 매체별 처리 내용,
 * 처리 날짜를 담는다. 광고성 문서가 하나도 없으면 null.
 *
 * <p>설정에서 바꿀 때는 동의·거부 모두 알린다. 가입·재동의 팝업에서는 아무것도 고르지 않은 사람에게까지 알림을
 * 띄우지 않도록 부르는 쪽이 {@link shouldNoticeEntryDecisions}로 거른다.
 */
export function marketingDecisionNotice(
  decisions: readonly MarketingDecision[],
  at: Date,
): { title: string; message: string } | null {
  const lines = MARKETING_CONSENT_TYPES.flatMap((type) => {
    const found = decisions.find((d) => d.type === type);
    if (!found) return [];
    return [
      translate('consent.marketingNoticeLine', {
        channel: translate(type === 'marketing_email' ? 'consent.marketingEmail' : 'consent.marketingPush'),
        result: translate(found.decision === 'granted' ? 'consent.marketingGranted' : 'consent.marketingDeclined'),
      }),
    ];
  });
  if (lines.length === 0) return null;
  return {
    title: translate('consent.marketingNoticeTitle'),
    message: [translate('consent.marketingNoticeBody', { date: dayLabel(at) }), ...lines].join('\n'),
  };
}

/** 가입·재동의 팝업에서 처리 결과를 띄울지 — 광고성 문서 중 하나라도 동의했을 때만. */
export function shouldNoticeEntryDecisions(decisions: readonly MarketingDecision[]): boolean {
  return decisions.some((d) => isMarketingConsent(d.type) && d.decision === 'granted');
}

/**
 * 가입·재동의 팝업에서 고른 결과 중 광고성 문서의 결정. 고르지 않은 선택 문서는 거절로 기록되므로 거절로 본다
 * (consent-entry-submission 의 withDeclinedDefaults 와 같은 규칙).
 */
export function entryMarketingDecisions(
  documents: readonly { id: string; type: string }[],
  choices: ReadonlyMap<string, 'granted' | 'declined'>,
): MarketingDecision[] {
  return documents
    .filter((document) => isMarketingConsent(document.type))
    .map((document): MarketingDecision => ({
      type: document.type,
      decision: choices.get(document.id) === 'granted' ? 'granted' : 'declined',
    }));
}
