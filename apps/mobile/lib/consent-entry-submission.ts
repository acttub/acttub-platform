import type {
  ConsentEntryDocument,
  ConsentEntryResponse,
} from './api.ts';

export type ConsentChoice = 'granted' | 'declined';

export function documentsForConsentEntry(
  entry: ConsentEntryResponse,
): ConsentEntryDocument[] {
  if (entry.entry_status === 'decision_required') {
    return entry.undecided_documents;
  }
  return [];
}

export function canSubmitConsentDecisions(
  documents: ConsentEntryDocument[],
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

function isMissingConsentDocument(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === 404 &&
    'code' in error &&
    error.code === 'consent_document_not_found'
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
      if (!action) throw new Error('모든 동의 문서의 결정을 선택해야 합니다.');
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
