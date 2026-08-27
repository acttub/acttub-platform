/**
 * 나갈 때 한줄평(SOMA-433) — 순수 로직. RN 모듈에 기대지 않아 node 테스트로 잠근다.
 *
 * 창은 한 줄을 실제로 보낼 때까지 뜬다 — 보내고 나면 다시 묻지 않는다(1회 = 제출 1회,
 * 2026-08-27 정정). 나가는 순간에 길게 물으면 다 이탈하므로 한 줄만 받고, 문구는
 * "한 번만 부탁드려요" 톤으로 간다(사용자 결정 2026-08-24).
 */

export type ExitReviewTrigger = 'leave' | 'finish';

export const EXIT_REVIEW_MAX_LENGTH = 100;

export type ExitReviewCopy = {
  title: string;
  subtitle: string;
  placeholder: string;
  submit: string;
  skip: string;
  notice: string;
  contactHint: string;
  contactEmailPlaceholder: string;
  contactPhonePlaceholder: string;
};

export function exitReviewCopy(trigger: ExitReviewTrigger): ExitReviewCopy {
  return {
    title: '잠깐만요… 한 줄만 부탁드려요 🥲',
    subtitle: '딱 한 번만 여쭤볼게요. 솔직한 한 줄이 개발에 정말 큰 도움이 돼요 ㅠㅠ',
    placeholder: '예) 질문이 날카로워서 좋았어요 · 답을 어디까지 써야 할지 몰랐어요',
    submit: trigger === 'finish' ? '한 줄 남기고 마치기' : '한 줄 남기고 나가기',
    skip: '다음에 할게요',
    notice: '답변은 개발에만 써요 · 이름은 남지 않아요 · 한 줄 보내주시면 다시 안 여쭤봐요',
    contactHint: '인터뷰로 이야기를 더 들려주실 수 있다면 연락처를 남겨주세요 (선택)',
    contactEmailPlaceholder: '이메일 (선택)',
    contactPhonePlaceholder: '전화번호 (선택)',
  };
}

/** 한 줄을 보낸 사람에게만 다시 안 띄운다 — 건너뛰기는 다음에 다시 여쭤본다. */
export function shouldOfferExitReview(alreadyAsked: boolean): boolean {
  return !alreadyAsked;
}

/** 보낼 수 있는 형태로 다듬는다. 빈 칸·공백뿐이면 null. */
export function sendableOneLiner(text: string): string | null {
  const trimmed = text.trim().slice(0, EXIT_REVIEW_MAX_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 시트에 남길 익명 식별자. 같은 사람이 몇 번 보냈는지만 갈라 보려는 것이라
 * 되돌릴 필요가 없고, UUID·이메일이 시트에 남으면 안 되므로 짧은 해시로 줄인다.
 */
export function anonymousUserHash(userId: string | null | undefined): string {
  if (!userId) return '';
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < userId.length; i += 1) {
    const c = userId.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x9e3779b1) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export const CONTACT_MAX_LENGTH = 80;

/**
 * 인터뷰 연락처(선택) — 비워도 한줄평 전송에는 아무 영향이 없다. 형식 검사로
 * 사람을 돌려보내지 않는다: 적어 준 것 자체가 호의라 다듬기만 하고 그대로 싣는다.
 */
export function sendableContact(value: string | null | undefined): string | null {
  const trimmed = value?.trim().slice(0, CONTACT_MAX_LENGTH);
  return trimmed ? trimmed : null;
}

export type OneLinerPayload = {
  kind: 'app_oneliner';
  text: string;
  platform: string;
  app_version: string;
  screen: string;
  session_id: string;
  user_hash: string;
  contact_email: string | null;
  contact_phone: string | null;
};

export function buildOneLinerPayload(input: {
  text: string;
  platform: string;
  appVersion: string;
  screen: string;
  sessionId: string | null | undefined;
  userId: string | null | undefined;
  contactEmail?: string | null;
  contactPhone?: string | null;
}): OneLinerPayload | null {
  const text = sendableOneLiner(input.text);
  if (!text) return null;
  return {
    kind: 'app_oneliner',
    text,
    platform: input.platform,
    app_version: input.appVersion,
    screen: input.screen,
    session_id: input.sessionId ?? '',
    user_hash: anonymousUserHash(input.userId),
    contact_email: sendableContact(input.contactEmail),
    contact_phone: sendableContact(input.contactPhone),
  };
}
