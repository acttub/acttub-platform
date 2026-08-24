"use client";

import { Suspense, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { NamePrompt } from "@/features/auth/name-prompt";
import { ConsentMarkdown } from "@/features/practice/consent-markdown";
import { useDisplayNameGate } from "@/features/auth/use-display-name-gate";
import {
  clearPendingConsents,
  hasAcceptedCurrentPrivacy,
  markPrivacyVersionAccepted,
  savePendingConsents,
} from "@/features/auth/pending-consents";
import {
  setAmplitudeUser,
  startAmplitude,
  trackConsentSubmitted,
} from "@/lib/analytics/amplitude";
import { logout } from "@/lib/api/v2/auth";
import { recordConsent } from "@/lib/api/v2/consents";
import { ApiError } from "@/lib/api/v2/errors";
import type { ConsentDocument } from "@/lib/api/v2/types";
import { sanitizeNextPath } from "@/lib/auth/next-path";
import { getStoredUser, isLoggedIn } from "@/lib/auth/token-store";
import { useResource } from "@/lib/react/use-resource";

import { loadConsentDocuments } from "./consent-documents";

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
  const consents = useResource(
    "consents",
    (_, signal) => loadConsentDocuments(signal),
    "약관 문서를 불러오지 못했어요.",
  );
  const [checkedDocumentIds, setCheckedDocumentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [completedDocumentIds, setCompletedDocumentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // 신규 계정은 로그인 직후 여기로 오므로, 앱에 들여보내기 전 호칭을 이 화면에서 묻는다.
  const { pendingDestination, enterApp, resolveName } = useDisplayNameGate();
  // 로그인에서 넘어온 목적지. 그냥 약관을 읽으러 온 경우(랜딩의 "안전 약속")에는 없다.
  const rawNext = searchParams.get("next");
  const nextPath = rawNext ? sanitizeNextPath(rawNext) : null;

  const requiredConsentsChecked = useMemo(() => {
    if (consents.state !== "ready" || consents.data.mode !== "pending") return false;
    return consents.data.documents
      .filter((document) => document.required)
      .every((document) => checkedDocumentIds.has(document.id));
  }, [checkedDocumentIds, consents]);

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
      consents.state !== "ready" ||
      consents.data.mode !== "pending" ||
      !requiredConsentsChecked ||
      submitting
    ) {
      return;
    }

    const remainingDocuments = consents.data.documents.filter(
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
        trackConsentSubmitted("forced_logout");
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
        trackConsentSubmitted("partial_fail");
        savePendingConsents(failedDocuments);
        setSubmitError(
          `${failedDocuments.length}개 동의 항목을 처리하지 못했어요. 다시 시도하면 실패한 항목만 요청해요.`,
        );
        return;
      }

      clearPendingConsents();
      // 필수 동의를 전부 서버에 기록한 순간이다. 어느 버전에 동의했는지까지 남겨야
      // 다음 개정 때 계측 쿠키가 저절로 유지되지 않는다(pending-consents.ts 참고).
      const acceptedPrivacy = consents.data.documents.find(
        (document) => document.type === "privacy",
      );
      if (acceptedPrivacy) markPrivacyVersionAccepted(acceptedPrivacy.version);
      if (isLoggedIn() && hasAcceptedCurrentPrivacy()) {
        // 이 순간부터만 SDK를 켠다. 앞서 실패한 제출 이벤트를 소급해서 보내지는 않는다.
        startAmplitude();
        const storedUser = getStoredUser();
        if (storedUser) setAmplitudeUser(storedUser.id);
      }
      trackConsentSubmitted("ok");
      await enterApp(sanitizeNextPath(searchParams.get("next")));
    } finally {
      setSubmitting(false);
    }
  }

  if (consents.state === "failed") {
    return (
      <TermsShell eyebrow="Acttub 약관" title="약관을 불러오지 못했어요">
        <p className="rounded-2xl bg-[#fff4f4] p-4 text-sm leading-6 text-[#d92d20]">
          {consents.message}
        </p>
      </TermsShell>
    );
  }

  // 키가 늘 있으므로 아직 묻지 않은 자리(idle)는 오지 않지만, 답을 꺼내려면 함께 걸러야
  // 한다 — 유니온을 소진하지 않으면 tsc 가 data 접근을 막는다.
  if (consents.state !== "ready") return <TermsLoading />;

  const { mode, documents } = consents.data;
  const isPendingMode = mode === "pending";

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
      {pendingDestination ? (
        <NamePrompt onSubmit={resolveName} onSkip={() => resolveName(null)} />
      ) : null}
      <form onSubmit={handleSubmit}>
        <div className="space-y-5">
          {documents.length > 0 ? (
            documents.map((document) => {
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
        ) : nextPath ? (
          // 동의를 이미 끝낸 뒤 이 화면이 다시 열린 경우(새로고침·뒤로가기)에는
          // 동의 항목이 남아 있지 않아 진행 버튼이 사라진다 — 갈 곳을 잃지 않게 길을 남긴다.
          <Link
            href={nextPath}
            className="mt-8 flex h-14 w-full items-center justify-center rounded-2xl bg-[#3182f6] px-5 text-base font-semibold text-white transition hover:bg-[#1b64da]"
          >
            계속하기
          </Link>
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
          className="mt-5 max-h-64 overflow-y-auto rounded-2xl bg-[#f9fafb] p-4 outline-none focus:ring-2 focus:ring-[#90c2ff]"
        >
          <ConsentMarkdown source={document.body} />
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
