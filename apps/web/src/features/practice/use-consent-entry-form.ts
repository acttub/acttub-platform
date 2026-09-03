"use client";

import { useEffect, useMemo, useState } from "react";
import { trackConsentSubmitted } from "@/lib/analytics/amplitude";
import { errorMessage } from "@/lib/api/v2/errors";
import type {
  ConsentEntryDocument,
  ConsentEntryResponse,
} from "@/lib/api/v2/types";
import {
  consentDocumentsFromEntry,
  loadConsentDocuments,
  type ConsentDocuments,
} from "./consent-documents";
import {
  canSubmitConsentDecisions,
  submitConsentDecisions,
  type ConsentChoice,
} from "./consent-entry-submission";

export type ConsentLoadState =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "ready"; data: ConsentDocuments };

type OnAllowed = (
  entry: ConsentEntryResponse,
  decidedDocuments: ConsentEntryDocument[],
  choices: ReadonlyMap<string, ConsentChoice>,
) => Promise<void>;

export type ConsentEntryForm = {
  consents: ConsentLoadState;
  choices: ReadonlyMap<string, ConsentChoice>;
  completedDocumentIds: ReadonlySet<string>;
  verificationPending: boolean;
  submitting: boolean;
  submitError: string | null;
  decisionDocuments: ConsentEntryDocument[];
  canSubmit: boolean;
  retryLoad: () => void;
  updateChoice: (documentId: string, choice: ConsentChoice) => void;
  submit: () => Promise<void>;
};

export function useConsentEntryForm(onAllowed: OnAllowed): ConsentEntryForm {
  const [consents, setConsents] = useState<ConsentLoadState>({
    state: "loading",
  });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [choices, setChoices] = useState<Map<string, ConsentChoice>>(
    () => new Map(),
  );
  const [completedDocumentIds, setCompletedDocumentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [verificationPending, setVerificationPending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 첫 조회와 수동 재조회, 저장 뒤 최신 결과 반영이 같은 답을 바꾼다. useResource가
  // 데이터를 들면 이 세 길이 별도 state를 하나 더 가져야 하므로 여기서는 직접 소유한다.
  useEffect(() => {
    const controller = new AbortController();
    void loadConsentDocuments(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setConsents({ state: "ready", data });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setConsents({
          state: "failed",
          message: errorMessage(cause, "약관 문서를 불러오지 못했어요."),
        });
      });
    return () => controller.abort();
  }, [loadAttempt]);

  const decisionDocuments = useMemo(() => {
    if (consents.state !== "ready") return [];
    if (consents.data.mode === "decision_required") {
      return consents.data.documents;
    }
    if (consents.data.mode === "blocked") {
      // 차단을 먼저 해소한다. 함께 있던 선택 미결정은 최종 재확인 뒤 별도 화면으로
      // 전환돼, 서비스 차단보다 자동 확인을 앞세우지 않는다.
      return consents.data.documents.filter(
        (document) =>
          document.required && document.current_decision !== "granted",
      );
    }
    return [];
  }, [consents]);

  const remainingDecisionDocuments = useMemo(
    () =>
      decisionDocuments.filter(
        (document) => !completedDocumentIds.has(document.id),
      ),
    [completedDocumentIds, decisionDocuments],
  );
  const canSubmit =
    verificationPending ||
    canSubmitConsentDecisions(remainingDecisionDocuments, choices);

  function retryLoad() {
    setConsents({ state: "loading" });
    setLoadAttempt((attempt) => attempt + 1);
  }

  function updateChoice(documentId: string, choice: ConsentChoice) {
    setChoices((current) => {
      const next = new Map(current);
      next.set(documentId, choice);
      return next;
    });
    setSubmitError(null);
  }

  async function submit() {
    if (
      consents.state !== "ready" ||
      decisionDocuments.length === 0 ||
      !canSubmit ||
      submitting
    ) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await submitConsentDecisions({
        documents: decisionDocuments,
        choices,
        completedDocumentIds,
      });
      setCompletedDocumentIds(new Set(result.completedDocumentIds));

      if (result.kind === "partial") {
        setVerificationPending(false);
        trackConsentSubmitted("partial_fail");
        setSubmitError(
          `${result.failedDocuments.length}개 동의 항목을 처리하지 못했어요. 다시 시도하면 실패한 항목만 요청해요.`,
        );
        return;
      }
      if (result.kind === "verification_failed") {
        setVerificationPending(true);
        setSubmitError(
          "저장한 결정은 유지됐지만 최종 결과를 확인하지 못했어요. 다시 시도하면 저장을 반복하지 않고 결과만 확인해요.",
        );
        return;
      }

      setVerificationPending(false);
      if (result.entry.entry_status !== "allowed") {
        setConsents({
          state: "ready",
          data: consentDocumentsFromEntry(result.entry),
        });
        setChoices(new Map());
        setCompletedDocumentIds(new Set());
        setSubmitError(
          result.entry.entry_status === "blocked"
            ? "서비스 이용에 필요한 필수 동의를 먼저 변경해 주세요."
            : "새로 확인할 동의 문서가 있어요. 모든 항목의 결정을 골라 주세요.",
        );
        return;
      }

      await onAllowed(result.entry, decisionDocuments, choices);
    } finally {
      setSubmitting(false);
    }
  }

  return {
    consents,
    choices,
    completedDocumentIds,
    verificationPending,
    submitting,
    submitError,
    decisionDocuments,
    canSubmit,
    retryLoad,
    updateChoice,
    submit,
  };
}
