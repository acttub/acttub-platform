"use client";

import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  clearPendingConsents,
  getPendingConsents,
  savePendingConsents,
} from "@/features/auth/pending-consents";
import { logout } from "@/lib/api/v2/auth";
import { recordConsent, listConsentDocuments } from "@/lib/api/v2/consents";
import { ApiError } from "@/lib/api/v2/errors";
import type { ConsentDocument } from "@/lib/api/v2/types";
import { sanitizeNextPath } from "@/lib/auth/next-path";

type ReadyState = {
  kind: "ready";
  mode: "pending" | "info";
  documents: ConsentDocument[];
};

type LoadState =
  | { kind: "loading" }
  | ReadyState
  | { kind: "error"; message: string };

export function TermsGate() {
  return (
    <Suspense fallback={<TermsLoading />}>
      <TermsGateContent />
    </Suspense>
  );
}

function TermsGateContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [checkedDocumentIds, setCheckedDocumentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [completedDocumentIds, setCompletedDocumentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadDocuments() {
      try {
        const pendingDocuments = getPendingConsents();
        if (pendingDocuments.length > 0) {
          if (active) {
            setState({ kind: "ready", mode: "pending", documents: pendingDocuments });
          }
          return;
        }

        const response = await listConsentDocuments();
        if (active) {
          setState({ kind: "ready", mode: "info", documents: response.documents });
        }
      } catch (error) {
        if (!active) return;
        setState({
          kind: "error",
          message: error instanceof Error ? error.message : "약관 문서를 불러오지 못했어요.",
        });
      }
    }

    void loadDocuments();
    return () => {
      active = false;
    };
  }, []);

  const requiredConsentsChecked = useMemo(() => {
    if (state.kind !== "ready" || state.mode !== "pending") return false;
    return state.documents
      .filter((document) => document.required)
      .every((document) => checkedDocumentIds.has(document.id));
  }, [checkedDocumentIds, state]);

  function updateChecked(documentId: string, checked: boolean) {
    setCheckedDocumentIds((current) => {
      const next = new Set(current);
      if (checked) next.add(documentId);
      else next.delete(documentId);
      return next;
    });
    setSubmitError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      state.kind !== "ready" ||
      state.mode !== "pending" ||
      !requiredConsentsChecked ||
      submitting
    ) {
      return;
    }

    const remainingDocuments = state.documents.filter(
      (document) => !completedDocumentIds.has(document.id),
    );
    setSubmitting(true);
    setSubmitError(null);

    try {
      const results = await Promise.allSettled(
        remainingDocuments.map(async (document) => {
          await recordConsent({
            document_id: document.id,
            action: checkedDocumentIds.has(document.id) ? "granted" : "declined",
          });
          return document.id;
        }),
      );

      const accountSuspended = results.some(
        (result) =>
          result.status !== "fulfilled" &&
          result.reason instanceof ApiError &&
          result.reason.status === 403 &&
          result.reason.code === "account_suspended",
      );
      const documentsChanged = results.some(
        (result) =>
          result.status !== "fulfilled" &&
          result.reason instanceof ApiError &&
          result.reason.status === 404 &&
          result.reason.code === "consent_document_not_found",
      );
      if (accountSuspended || documentsChanged) {
        clearPendingConsents();
        await logout();
        const params = new URLSearchParams({
          next: sanitizeNextPath(searchParams.get("next")),
          notice: accountSuspended ? "account_suspended" : "consents_updated",
        });
        router.replace(`/login?${params.toString()}`);
        return;
      }

      const newlyCompletedIds = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const failedDocuments = results.flatMap((result, index) =>
        result.status !== "fulfilled" ? [remainingDocuments[index]] : [],
      );
      if (newlyCompletedIds.length > 0) {
        setCompletedDocumentIds((current) => {
          const next = new Set(current);
          newlyCompletedIds.forEach((documentId) => next.add(documentId));
          return next;
        });
      }

      if (failedDocuments.length > 0) {
        savePendingConsents(failedDocuments);
        setSubmitError(
          `${failedDocuments.length}개 동의 항목을 처리하지 못했어요. 다시 시도하면 실패한 항목만 요청해요.`,
        );
        return;
      }

      clearPendingConsents();
      router.replace(sanitizeNextPath(searchParams.get("next")));
    } finally {
      setSubmitting(false);
    }
  }

  if (state.kind === "loading") return <TermsLoading />;

  if (state.kind === "error") {
    return (
      <TermsShell eyebrow="Acttub 약관" title="약관을 불러오지 못했어요">
        <p className="rounded-2xl bg-[#fff4f4] p-4 text-sm leading-6 text-[#d92d20]">
          {state.message}
        </p>
      </TermsShell>
    );
  }

  const isPendingMode = state.mode === "pending";

  return (
    <TermsShell
      eyebrow={isPendingMode ? "Acttub 시작 전 확인" : "Acttub 약관"}
      title={isPendingMode ? "계속하기 전에 확인해 주세요" : "약관 및 동의 문서"}
      description={
        isPendingMode
          ? "필수 항목에 동의하면 Acttub을 계속 이용할 수 있어요. 선택 항목은 동의하지 않아도 괜찮아요."
          : "현재 제공 중인 약관과 데이터 처리 안내를 확인할 수 있어요."
      }
    >
      <form onSubmit={handleSubmit}>
        <div className="space-y-5">
          {state.documents.length > 0 ? (
            state.documents.map((document) => {
              const completed = completedDocumentIds.has(document.id);
              return (
                <ConsentDocumentCard
                  key={document.id}
                  document={document}
                  interactive={isPendingMode}
                  checked={checkedDocumentIds.has(document.id)}
                  completed={completed}
                  disabled={submitting || completed}
                  onCheckedChange={(checked) => updateChecked(document.id, checked)}
                />
              );
            })
          ) : (
            <p className="rounded-3xl border border-[#e5e8eb] bg-white p-6 text-sm text-[#4e5968]">
              현재 공개된 약관 문서가 없어요.
            </p>
          )}
        </div>

        {isPendingMode ? (
          <>
            {submitError ? (
              <p className="mt-5 rounded-2xl bg-[#fff4f4] p-4 text-sm leading-6 text-[#d92d20]">
                {submitError}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={!requiredConsentsChecked || submitting}
              className="mt-8 h-14 w-full rounded-2xl bg-[#3182f6] px-5 text-base font-semibold text-white transition hover:bg-[#1b64da] disabled:cursor-not-allowed disabled:bg-[#b0d2ff]"
            >
              {submitting ? "동의 내용을 저장하고 있어요" : "확인하고 계속하기"}
            </button>
            <p className="mt-4 text-center text-sm leading-6 text-[#8b95a1]">
              선택 항목을 체크하지 않으면 동의하지 않음으로 기록돼요.
            </p>
          </>
        ) : null}
      </form>
    </TermsShell>
  );
}

function TermsLoading() {
  return (
    <TermsShell eyebrow="Acttub 약관" title="약관을 확인하고 있어요">
      <p className="rounded-2xl bg-[#f2f4f6] p-4 text-sm text-[#4e5968]">
        필요한 문서를 불러오는 중이에요.
      </p>
    </TermsShell>
  );
}

function TermsShell({
  children,
  description,
  eyebrow,
  title,
}: {
  children: React.ReactNode;
  description?: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl px-6 py-12 sm:py-16">
      <p className="text-sm font-semibold text-[#3182f6]">{eyebrow}</p>
      <h1 className="mt-3 text-3xl font-bold tracking-[-0.03em] text-[#191f28]">{title}</h1>
      {description ? (
        <p className="mt-3 max-w-2xl text-base leading-7 text-[#4e5968]">{description}</p>
      ) : null}
      <div className="mt-8">{children}</div>
    </main>
  );
}

function ConsentDocumentCard({
  checked,
  completed,
  disabled,
  document,
  interactive,
  onCheckedChange,
}: {
  checked: boolean;
  completed: boolean;
  disabled: boolean;
  document: ConsentDocument;
  interactive: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const bodyId = `consent-document-${document.id}`;

  return (
    <article className="overflow-hidden rounded-3xl border border-[#e5e8eb] bg-white shadow-sm">
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[#8b95a1]">
              {document.required ? "필수 동의" : "선택 동의"}
            </p>
            <h2 className="mt-1 text-lg font-bold tracking-[-0.02em] text-[#191f28]">
              {document.title}
            </h2>
          </div>
          {completed ? (
            <span className="shrink-0 rounded-full bg-[#e8f3ff] px-3 py-1 text-xs font-semibold text-[#1b64da]">
              처리 완료
            </span>
          ) : null}
        </div>

        <div
          id={bodyId}
          tabIndex={0}
          className="mt-5 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-[#f9fafb] p-4 text-sm leading-6 text-[#4e5968] outline-none focus:ring-2 focus:ring-[#90c2ff]"
        >
          {document.body}
        </div>

        {interactive ? (
          <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm font-semibold leading-6 text-[#4e5968] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
            <input
              type="checkbox"
              checked={checked}
              required={document.required}
              disabled={disabled}
              aria-describedby={bodyId}
              onChange={(event) => onCheckedChange(event.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[#3182f6]"
            />
            <span>
              {document.title}에 {document.required ? "동의합니다." : "동의합니다. (선택)"}
            </span>
          </label>
        ) : null}
      </div>

      <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[#f2f4f6] bg-[#f9fafb] px-6 py-4 text-xs text-[#8b95a1]">
        <span>버전 {document.version}</span>
        <span>게시일 {formatPublishedAt(document.published_at)}</span>
      </footer>
    </article>
  );
}

function formatPublishedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "long",
    timeZone: "Asia/Seoul",
  }).format(date);
}
