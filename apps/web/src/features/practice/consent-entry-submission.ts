import type { ConsentEntryDocument } from "@/lib/api/v2/types";
import { recordConsent } from "@/lib/api/v2/consents";
import { ApiError } from "@/lib/api/v2/errors";
import { refreshConsentEntry } from "@/features/auth/consent-entry";

export type ConsentChoice = "granted" | "declined";

export function canSubmitConsentDecisions(
  documents: ConsentEntryDocument[],
  choices: ReadonlyMap<string, ConsentChoice>,
): boolean {
  return (
    documents.length > 0 &&
    documents.every((document) => {
      const choice = choices.get(document.id);
      return document.required
        ? choice === "granted"
        : choice === "granted" || choice === "declined";
    })
  );
}

export async function submitConsentDecisions({
  documents,
  choices,
  completedDocumentIds,
}: {
  documents: ConsentEntryDocument[];
  choices: ReadonlyMap<string, ConsentChoice>;
  completedDocumentIds: ReadonlySet<string>;
}) {
  const remainingDocuments = documents.filter(
    (document) => !completedDocumentIds.has(document.id),
  );
  const results = await Promise.allSettled(
    remainingDocuments.map(async (document) => {
      const action = choices.get(document.id);
      if (!action) throw new Error("모든 동의 문서의 결정을 선택해야 합니다.");
      await recordConsent({ document_id: document.id, action });
      return document.id;
    }),
  );

  const newlyCompletedIds = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const staleDocumentIds = results.flatMap((result, index) =>
    result.status === "rejected" &&
    result.reason instanceof ApiError &&
    result.reason.status === 404 &&
    result.reason.code === "consent_document_not_found"
      ? [remainingDocuments[index].id]
      : [],
  );
  const completedIds = [
    ...completedDocumentIds,
    ...[...newlyCompletedIds, ...staleDocumentIds].filter(
      (id) => !completedDocumentIds.has(id),
    ),
  ];
  const failedDocuments = results.flatMap((result, index) =>
    result.status === "rejected" &&
    !staleDocumentIds.includes(remainingDocuments[index].id)
      ? [remainingDocuments[index]]
      : [],
  );

  if (failedDocuments.length > 0) {
    return {
      kind: "partial" as const,
      completedDocumentIds: completedIds,
      failedDocuments,
    };
  }
  try {
    const entry = await refreshConsentEntry();
    return {
      kind: "verified" as const,
      completedDocumentIds: completedIds,
      entry,
    };
  } catch (cause) {
    return {
      kind: "verification_failed" as const,
      completedDocumentIds: completedIds,
      cause,
    };
  }
}
