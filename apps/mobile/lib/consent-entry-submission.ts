import type {
  ConsentDocument,
  ConsentEntryDocument,
  ConsentEntryResponse,
} from './api.ts';
import { translate } from './i18n.ts';

export type ConsentChoice = 'granted' | 'declined';

export function documentsForConsentEntry(
  entry: ConsentEntryResponse,
): ConsentEntryDocument[] {
  if (entry.entry_status === 'decision_required') {
    return entry.undecided_documents;
  }
  return [];
}

/**
 * 필수 문서에 모두 동의하면 진행할 수 있다.
 *
 * <p><b>선택 문서는 고르지 않아도 된다</b> — 체크하면 동의, 비워 두면 거절이다. 전에는
 * 동의·거절 중 하나를 반드시 눌러야 했는데, 거절 버튼이 있으면 안 고르고 지나갈 수가 없어
 * 선택이라는 말과 어긋났다. 거절은 누르는 것이 아니라 <b>안 고르는 것</b>이다.
 */
export function canSubmitConsentDecisions(
  documents: readonly ConsentDocument[],
  choices: ReadonlyMap<string, ConsentChoice>,
): boolean {
  return (
    documents.length > 0 &&
    documents.every(
      (document) => !document.required || choices.get(document.id) === 'granted',
    )
  );
}

/**
 * 서버로 보낼 결정. 선택 문서를 안 골랐으면 거절로 채운다 — 화면에서 비워 둔 것이
 * 거절이라는 뜻이므로, 결정을 남기지 않고 넘어가면 다음에 또 묻게 된다.
 */
export function withDeclinedDefaults(
  documents: readonly ConsentDocument[],
  choices: ReadonlyMap<string, ConsentChoice>,
): Map<string, ConsentChoice> {
  const filled = new Map(choices);
  for (const document of documents) {
    if (!document.required && !filled.has(document.id)) {
      filled.set(document.id, 'declined');
    }
  }
  return filled;
}

/**
 * "전체 동의"는 필수 문서만 채운다. 선택 문서는 묶어서 동의받지 않고 그 줄의 체크로만
 * 결정한다. 이미 고른 선택 문서는 건드리지 않는다.
 */
export function grantAllRequired(
  documents: readonly ConsentDocument[],
  choices: ReadonlyMap<string, ConsentChoice>,
): Map<string, ConsentChoice> {
  const next = new Map(choices);
  for (const document of documents) {
    if (document.required) {
      next.set(document.id, 'granted');
    }
  }
  return next;
}

export type SignupDecision = { document_id: string; action: ConsentChoice };

/**
 * 가입 제출만 모든 문서의 결정을 한 번에 담는다(그 밖의 결정은 문서 하나씩).
 *
 * <p>안 고른 선택 문서는 <b>여기서</b> 거절로 채운다. 부르는 쪽이 채우도록 맡기면 한 곳만
 * 빠뜨려도 결정 없는 항목이 서버로 나간다.
 */
export function buildSignupDecisions(
  documents: readonly ConsentDocument[],
  choices: ReadonlyMap<string, ConsentChoice>,
): SignupDecision[] {
  if (!canSubmitConsentDecisions(documents, choices)) {
    throw new Error(translate('consent.undecided'));
  }
  const filled = withDeclinedDefaults(documents, choices);
  return documents.map((document) => ({
    document_id: document.id,
    action: filled.get(document.id)!,
  }));
}

export type SignupFailureAction = 'restart_login' | 'reload_documents' | 'retry';

/** 가입 제출이 실패했을 때 화면이 할 일. */
export function signupFailureAction(error: unknown): SignupFailureAction {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (
    code === 'invalid_signup_token' ||
    code === 'account_exists_with_different_provider'
  ) {
    return 'restart_login';
  }
  if (code === 'consent_document_outdated' || code === 'consent_document_not_found') {
    return 'reload_documents';
  }
  return 'retry';
}

type SubmitConsentDecisionsInput = {
  documents: ConsentEntryDocument[];
  choices: ReadonlyMap<string, ConsentChoice>;
  completedDocumentIds: ReadonlySet<string>;
  recordDecision: (
    documentId: string,
    action: ConsentChoice,
  ) => Promise<void>;
  refreshEntry: () => Promise<ConsentEntryResponse>;
};

/** 보는 사이 새 판이 나와 이 문서 id에는 더 결정할 수 없다. 다시 시도하지 않고 목록을 다시 받는다. */
function isMissingConsentDocument(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error) || !('code' in error)) {
    return false;
  }
  return (
    (error.status === 404 && error.code === 'consent_document_not_found') ||
    (error.status === 409 && error.code === 'consent_document_outdated')
  );
}

export async function submitConsentDecisions({
  documents,
  choices,
  completedDocumentIds,
  recordDecision,
  refreshEntry,
}: SubmitConsentDecisionsInput) {
  const remainingDocuments = documents.filter(
    (document) => !completedDocumentIds.has(document.id),
  );
  // 안 고른 선택 문서는 거절이다 — 결정을 안 남기면 다음에 또 묻게 된다.
  const filled = withDeclinedDefaults(documents, choices);
  const results = await Promise.allSettled(
    remainingDocuments.map(async (document) => {
      const action = filled.get(document.id);
      if (!action) throw new Error(translate('consent.undecided'));
      await recordDecision(document.id, action);
      return document.id;
    }),
  );
  const newlyCompletedIds = results.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
  const staleDocumentIds = results.flatMap((result, index) =>
    result.status === 'rejected' && isMissingConsentDocument(result.reason)
      ? [remainingDocuments[index].id]
      : [],
  );
  const completedIds = [
    ...completedDocumentIds,
    ...newlyCompletedIds,
    ...staleDocumentIds,
  ];
  const failedDocuments = results.flatMap((result, index) =>
    result.status === 'rejected' &&
    !staleDocumentIds.includes(remainingDocuments[index].id)
      ? [remainingDocuments[index]]
      : [],
  );

  if (failedDocuments.length > 0) {
    return {
      kind: 'partial' as const,
      completedDocumentIds: completedIds,
      failedDocuments,
    };
  }
  try {
    const entry = await refreshEntry();
    return {
      kind: 'verified' as const,
      completedDocumentIds: completedIds,
      entry,
    };
  } catch (cause) {
    return {
      kind: 'verification_failed' as const,
      completedDocumentIds: completedIds,
      cause,
    };
  }
}

/**
 * 가입 화면에 보이지 않는 선택 문서. 개인정보 수집·이용 동의 v9 부터 이 두 처리가 그 동의에 들어 있어(SOMA-726)
 * 서버가 v9 동의자를 두 기능의 동의자로 본다. 가입 제출에서는 안 고른 선택 문서처럼 거절로 채워진다.
 * (v9 이전 동의자는 기능 안 팝업 — use-cloud-voice, script_split_consent_required → R2.14 — 이 그대로 묻는다.)
 */
export const SIGNUP_DEFERRED_TYPES: readonly string[] = ['cloud_voice', 'script_split'];

/** 광고성 정보 수신 동의. 가입 화면에서는 한 줄로 묶고, 그 아래에서 수단별로 고른다. */
export const MARKETING_TYPES: readonly string[] = ['marketing_email', 'marketing_push'];

export type SignupScreenLayout = {
  /** 필수 문서(한 줄씩). */
  required: ConsentDocument[];
  /** 묶지 않는 선택 문서(한 줄씩). */
  optional: ConsentDocument[];
  /** 광고성 정보 수신 문서들. 한 줄로 보이고 아래에서 이메일·앱 푸시를 따로 고른다. */
  marketing: ConsentDocument[];
};

/** 가입 화면의 줄 구성. 기능 안에서 묻는 선택 문서는 빼고, 광고성 정보 수신은 한 묶음으로 모은다. */
export function signupScreenLayout(documents: readonly ConsentDocument[]): SignupScreenLayout {
  const visible = documents.filter(
    (d) => d.required || !SIGNUP_DEFERRED_TYPES.includes(d.type),
  );
  return {
    required: visible.filter((d) => d.required),
    optional: visible.filter((d) => !d.required && !MARKETING_TYPES.includes(d.type)),
    marketing: visible.filter((d) => !d.required && MARKETING_TYPES.includes(d.type)),
  };
}

/**
 * 묶음 줄을 눌렀을 때. 묶음의 문서가 모두 동의 상태면 모두 비우고(=거절), 아니면 모두 동의한다.
 * 다른 문서의 결정은 건드리지 않는다.
 */
export function toggleConsentGroup(
  group: readonly ConsentDocument[],
  choices: Readonly<Record<string, ConsentChoice>>,
): Record<string, ConsentChoice> {
  const allGranted = group.length > 0 && group.every((d) => choices[d.id] === 'granted');
  const next = { ...choices };
  for (const d of group) {
    if (allGranted) delete next[d.id];
    else next[d.id] = 'granted';
  }
  return next;
}
