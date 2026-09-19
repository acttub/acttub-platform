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

/** 필수 문서는 동의만, 선택 문서는 동의·거절 중 하나를 골라야 한다. 선택 문서에 기본값은 없다. */
export function canSubmitConsentDecisions(
  documents: readonly ConsentDocument[],
  choices: ReadonlyMap<string, ConsentChoice>,
): boolean {
  return (
    documents.length > 0 &&
    documents.every((document) => {
      const choice = choices.get(document.id);
      return document.required
        ? choice === 'granted'
        : choice === 'granted' || choice === 'declined';
    })
  );
}

/**
 * "전체 동의"는 필수 문서만 채운다. 선택 문서는 묶어서 동의받지 않고 그 줄의 두 버튼으로만
 * 결정한다. 저장이 끝난 문서와 이미 고른 선택 문서는 건드리지 않는다.
 */
export function grantAllRequired(
  documents: readonly ConsentDocument[],
  choices: ReadonlyMap<string, ConsentChoice>,
  completedDocumentIds: ReadonlySet<string>,
): Map<string, ConsentChoice> {
  const next = new Map(choices);
  for (const document of documents) {
    if (document.required && !completedDocumentIds.has(document.id)) {
      next.set(document.id, 'granted');
    }
  }
  return next;
}

export type SignupDecision = { document_id: string; action: ConsentChoice };

/** 가입 제출만 모든 문서의 결정을 한 번에 담는다(그 밖의 결정은 문서 하나씩). */
export function buildSignupDecisions(
  documents: readonly ConsentDocument[],
  choices: ReadonlyMap<string, ConsentChoice>,
): SignupDecision[] {
  if (!canSubmitConsentDecisions(documents, choices)) {
    throw new Error(translate('consent.undecided'));
  }
  return documents.map((document) => ({
    document_id: document.id,
    action: choices.get(document.id)!,
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
  const results = await Promise.allSettled(
    remainingDocuments.map(async (document) => {
      const action = choices.get(document.id);
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
