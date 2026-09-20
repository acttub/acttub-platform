import type {
  ConsentDecision,
  ConsentEntryResponse,
} from './api.ts';

export type ConsentEntryReader = {
  readEntry: () => Promise<ConsentEntryResponse>;
};

/**
 * 인증 세션 하나 동안의 동의 진입 판정(GET /v2/consents/entry). 같은 세션에서는 한 번만 읽고,
 * 결정을 저장한 뒤의 확인은 캐시를 건너뛴다. 로그아웃·계정 전환 때 clear 한다.
 */
export function createConsentEntrySession(reader: ConsentEntryReader) {
  let cachedEntry: Promise<ConsentEntryResponse> | null = null;

  function loadAndCache(): Promise<ConsentEntryResponse> {
    const response = reader.readEntry().catch((error: unknown) => {
      if (cachedEntry === response) cachedEntry = null;
      throw error;
    });
    cachedEntry = response;
    return response;
  }

  function readOnce(): Promise<ConsentEntryResponse> {
    return cachedEntry ?? loadAndCache();
  }

  function refresh(): Promise<ConsentEntryResponse> {
    return loadAndCache();
  }

  function clear(): void {
    cachedEntry = null;
  }

  return { readOnce, refresh, clear };
}

/** 설정의 동의 목록 한 줄(account.consent). 문서마다 제목·판·시행일·내 결정·결정 시각. */
export type ConsentSettingsRow = {
  id: string;
  title: string;
  body: string;
  required: boolean;
  version: string;
  /** 시행일은 발행 시각(published_at)이다. 문서는 발행하는 순간 효력이 생긴다. */
  effectiveDate: string | null;
  decision: ConsentDecision | null;
  decidedDate: string | null;
  /**
   * 선택 문서만 설정에서 동의와 거절을 오간다. 필수 문서는 내용만 본다 — 필수 동의를 거두는
   * 길은 탈퇴뿐이다.
   */
  canChange: boolean;
};

/**
 * 'YYYY.MM.DD'. 못 읽는 값이면 null. utcOffsetMinutes 를 주지 않으면 기기 시간대로 읽는다
 * (테스트는 시간대에 기대지 않으려고 값을 준다).
 */
function dayLabel(iso: string | null | undefined, utcOffsetMinutes?: number): string | null {
  if (!iso) return null;
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  const offset = utcOffsetMinutes ?? -instant.getTimezoneOffset();
  const shifted = new Date(instant.getTime() + offset * 60_000);
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shifted.getUTCFullYear()}.${month}.${day}`;
}

export function consentSettingsRows(
  entry: ConsentEntryResponse,
  options: { utcOffsetMinutes?: number } = {},
): ConsentSettingsRow[] {
  return entry.documents.map((document) => ({
    id: document.id,
    title: document.title,
    body: document.body,
    required: document.required,
    version: document.version,
    effectiveDate: dayLabel(document.published_at, options.utcOffsetMinutes),
    decision: document.current_decision,
    decidedDate: dayLabel(document.decided_at, options.utcOffsetMinutes),
    canChange: !document.required,
  }));
}

/**
 * 설정에서 선택 동의를 바꾸다 실패했을 때. 옛 판(409)이나 없는 문서(404)면 보는 사이 새 판이
 * 나온 것이라 목록을 다시 받아 현재 판을 보여 준다.
 */
export function consentChangeFailureAction(error: unknown): 'reload' | 'show_error' {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  return code === 'consent_document_outdated' || code === 'consent_document_not_found'
    ? 'reload'
    : 'show_error';
}
