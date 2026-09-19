import { ApiError, classifyUnprocessable } from './api-request.ts';

/**
 * 포트폴리오 편집의 순수 로직(account.portfolio). 배우가 오디션에 낼 소개글·경력·사진을 적어
 * 두고 공유 링크로 보여 준다. 가입 때 받는 프로필 여섯 항목과는 다른 것이다.
 *
 * 항목마다 따로 저장한다 — 소개글, 경력 하나, 사진 하나, 순서, 공유 링크가 각각 요청 하나다.
 * 값 이름과 상한은 서버의 허용값과 같다. 화면 문구는 locales 의 portfolio 에 있다.
 */
export const CREDIT_KINDS = ['film', 'drama', 'play', 'musical', 'ad', 'other'] as const;
export type CreditKind = (typeof CREDIT_KINDS)[number];

export const INTRO_MAX = 2000;
export const CREDIT_TEXT_MAX = 100;
export const CREDIT_MAX = 50;
export const PHOTO_MAX = 10;
export const CREDIT_YEAR_MIN = 1900;

export type PortfolioCredit = {
  id: string;
  title: string;
  role: string;
  year: number;
  kind: CreditKind;
};

export type PortfolioPhoto = { id: string; url: string };

/** 공유 링크. 주소는 서버가 주는 url 을 그대로 쓴다 — 앱이 조립하지 않는다. */
export type PortfolioShare = { enabled: boolean; slug: string | null; url: string | null };

export type Portfolio = {
  intro: string | null;
  credits: PortfolioCredit[];
  photos: PortfolioPhoto[];
  share: PortfolioShare;
};

export type CreditPayload = Omit<PortfolioCredit, 'id'>;

/** 편집 중인 경력. 연도는 입력 중인 글자 그대로 든다. */
export type CreditDraft = { title: string; role: string; year: string; kind: CreditKind | null };

export type CreditFieldError = 'required' | 'too_long' | 'out_of_range';
export type CreditDraftErrors = Partial<Record<keyof CreditDraft, CreditFieldError>>;

/** 여러 줄 글이다. 앞뒤 공백만 떼고, 비었으면 null(소개글 지우기)이다. */
export function normalizeIntro(text: string | null | undefined): string | null {
  const intro = text?.trim() ?? '';
  return intro.length > 0 ? intro : null;
}

export function isIntroValid(text: string | null | undefined): boolean {
  return [...(normalizeIntro(text) ?? '')].length <= INTRO_MAX;
}

export function emptyCreditDraft(): CreditDraft {
  return { title: '', role: '', year: '', kind: null };
}

export function creditDraftFrom(credit: PortfolioCredit): CreditDraft {
  return { title: credit.title, role: credit.role, year: String(credit.year), kind: credit.kind };
}

/** 서버는 한국 시간으로 센다. 연도는 1900년부터 내년까지다. */
function maxCreditYear(now: Date): number {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCFullYear() + 1;
}

function textError(value: string): CreditFieldError | null {
  const text = value.trim();
  if (text.length === 0) return 'required';
  return [...text].length > CREDIT_TEXT_MAX ? 'too_long' : null;
}

/** 서버에서 본문 모양 오류(422 배열)가 될 입력을 화면에서 먼저 거른다. */
export function validateCreditDraft(
  draft: CreditDraft,
  now: Date,
): { ok: true; payload: CreditPayload } | { ok: false; errors: CreditDraftErrors } {
  const errors: CreditDraftErrors = {};
  const titleError = textError(draft.title);
  const roleError = textError(draft.role);
  if (titleError) errors.title = titleError;
  if (roleError) errors.role = roleError;

  const yearText = draft.year.trim();
  const year = /^[0-9]{4}$/.test(yearText) ? Number(yearText) : null;
  if (yearText.length === 0) errors.year = 'required';
  else if (year === null || year < CREDIT_YEAR_MIN || year > maxCreditYear(now)) {
    errors.year = 'out_of_range';
  }

  const kind = (CREDIT_KINDS as readonly unknown[]).includes(draft.kind) ? draft.kind : null;
  if (kind === null) errors.kind = 'required';

  if (Object.keys(errors).length > 0 || year === null || kind === null) {
    return { ok: false, errors };
  }
  return { ok: true, payload: { title: draft.title.trim(), role: draft.role.trim(), year, kind } };
}

/** 경력 수정은 보낸 항목만 바꾼다. 바뀐 것이 없으면 null — 요청을 보내지 않는다. */
export function creditPatch(
  original: PortfolioCredit,
  next: CreditPayload,
): Partial<CreditPayload> | null {
  const patch: Partial<CreditPayload> = {};
  if (next.title !== original.title) patch.title = next.title;
  if (next.role !== original.role) patch.role = next.role;
  if (next.year !== original.year) patch.year = next.year;
  if (next.kind !== original.kind) patch.kind = next.kind;
  return Object.keys(patch).length > 0 ? patch : null;
}

export function canAddCredit(portfolio: Pick<Portfolio, 'credits'>): boolean {
  return portfolio.credits.length < CREDIT_MAX;
}

export function canAddPhoto(portfolio: Pick<Portfolio, 'photos'>): boolean {
  return portfolio.photos.length < PHOTO_MAX;
}

/**
 * 한 칸 위나 아래로 옮긴 새 목록. 순서가 그대로면(맨 위를 위로, 없는 id) null — 요청을 보내지
 * 않는다. 원본은 건드리지 않아 서버가 거절하면 그대로 되돌릴 수 있다.
 */
export function moveItem<T extends { id: string }>(
  items: readonly T[],
  id: string,
  direction: 'up' | 'down',
): T[] | null {
  const from = items.findIndex((item) => item.id === id);
  const to = direction === 'up' ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= items.length) return null;
  const next = [...items];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** 순서 바꾸기는 지금 있는 id 를 원하는 순서로 전부 보낸다. */
export function orderPayload(items: readonly { id: string }[]): { ids: string[] } {
  return { ids: items.map((item) => item.id) };
}

export type PortfolioFailureKind =
  /** 이미 10장(열한 번째 사진). */
  | 'photo_limit'
  /** 이미 50개(쉰한 번째 경력). */
  | 'credit_limit'
  /** 보낸 순서가 지금 목록과 다르다 — 다른 기기에서 그 사이 추가·삭제했다. */
  | 'order_mismatch'
  /** 이미 지운 경력·사진. 없는 것과 남의 것을 구분하지 않는다. */
  | 'gone'
  /** 413·415 는 앱을 거치지 않은 올리기를 막는 안전망이다. 정상 앱에서는 나오지 않는다. */
  | 'photo_too_large'
  | 'photo_not_image'
  /** 올린 객체가 없거나 주소가 만료됐다. 주소부터 다시 받는다. */
  | 'upload_again'
  /** 본문 모양이 틀린 422(배열). 화면 검증이 놓친 앱 버그다. */
  | 'client_bug'
  | 'retry';

/** 실패의 종류와, 목록을 다시 받아야 하는지. */
export function portfolioFailure(error: unknown): { kind: PortfolioFailureKind; reload: boolean } {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'portfolio_photo_limit_exceeded':
        return { kind: 'photo_limit', reload: true };
      case 'portfolio_credit_limit_exceeded':
        return { kind: 'credit_limit', reload: true };
      case 'order_mismatch':
        return { kind: 'order_mismatch', reload: true };
      case 'portfolio_credit_not_found':
      case 'portfolio_photo_not_found':
        return { kind: 'gone', reload: true };
      case 'upload_too_large':
        return { kind: 'photo_too_large', reload: false };
      case 'unsupported_media_type':
        return { kind: 'photo_not_image', reload: false };
      case 'upload_not_found':
      case 'upload_intent_expired':
      case 'upload_size_mismatch':
        return { kind: 'upload_again', reload: true };
      default:
        break;
    }
    if (classifyUnprocessable(error)?.kind === 'client_bug') {
      return { kind: 'client_bug', reload: false };
    }
  }
  return { kind: 'retry', reload: false };
}
