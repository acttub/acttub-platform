"use client";

import { Suspense, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { NamePrompt } from "@/features/auth/name-prompt";
import { useDisplayNameGate } from "@/features/auth/use-display-name-gate";
import {
  clearPendingConsents,
  hasAcceptedCurrentPrivacy,
  markPrivacyVersionAccepted,
} from "@/features/auth/pending-consents";
import { ConsentMarkdown } from "@/features/practice/consent-markdown";
import {
  setAmplitudeUser,
  startAmplitude,
  trackConsentSubmitted,
} from "@/lib/analytics/amplitude";
import type { ConsentEntryDocument } from "@/lib/api/v2/types";
import { sanitizeNextPath } from "@/lib/auth/next-path";
import { getStoredUser, isLoggedIn } from "@/lib/auth/token-store";

import type { ConsentChoice } from "./consent-entry-submission";
import { useConsentEntryForm } from "./use-consent-entry-form";

export function TermsGate() {
  return (
    <Suspense fallback={<TermsLoading />}>
      <TermsGateContent />
    </Suspense>
  );
}

function TermsGateContent() {
  const searchParams = useSearchParams();
  // 신규 계정은 로그인 직후 여기로 오므로, 앱에 들여보내기 전 호칭을 이 화면에서 묻는다.
  const { pendingDestination, enterApp, resolveName } = useDisplayNameGate();
  // 로그인에서 넘어온 목적지. 그냥 약관을 읽으러 온 경우(랜딩의 "안전 약속")에는 없다.
  const rawNext = searchParams.get("next");
  const nextPath = rawNext ? sanitizeNextPath(rawNext) : null;
  const {
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
  } = useConsentEntryForm(async (_entry, decidedDocuments, decisions) => {
    clearPendingConsents();
    // 실제로 저장한 개인정보처리방침 수락만 이 기기의 계측 동의로 기록한다.
    const acceptedPrivacy = decidedDocuments.find(
      (document) =>
        document.type === "privacy" && decisions.get(document.id) === "granted",
    );
    if (acceptedPrivacy) markPrivacyVersionAccepted(acceptedPrivacy.version);
    if (isLoggedIn() && hasAcceptedCurrentPrivacy()) {
      startAmplitude();
      const storedUser = getStoredUser();
      if (storedUser) setAmplitudeUser(storedUser.id);
    }
    trackConsentSubmitted("ok");
    await enterApp(sanitizeNextPath(searchParams.get("next")));
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submit();
  }

  if (consents.state === "failed") {
    return (
      <TermsShell eyebrow="Acttub 약관" title="약관을 불러오지 못했어요">
        <p className="rounded-2xl bg-[#fff4f4] p-4 text-sm leading-6 text-[#d92d20]">
          {consents.message}
        </p>
        <button
          type="button"
          onClick={retryLoad}
          className="mt-5 h-12 w-full rounded-2xl bg-[#3182f6] px-4 text-sm font-black text-white transition hover:bg-[#1b64da]"
        >
          다시 시도하기
        </button>
      </TermsShell>
    );
  }

  if (consents.state !== "ready") return <TermsLoading />;

  const { mode, documents } = consents.data;
  const isDecisionMode = mode === "decision_required";
  const isBlockedMode = mode === "blocked";
  const interactiveIds = new Set(decisionDocuments.map((document) => document.id));

  return (
    <TermsShell
      eyebrow={
        isDecisionMode
          ? "Acttub 시작 전 확인"
          : isBlockedMode
            ? "Acttub 동의 관리"
            : "Acttub 약관"
      }
      title={
        isDecisionMode
          ? "계속하기 전에 결정해 주세요"
          : isBlockedMode
            ? "서비스 이용에 필요한 동의를 확인해 주세요"
            : "약관 및 동의 문서"
      }
      description={
        isDecisionMode
          ? "필수 항목은 수락해야 하고, 선택 항목도 수락 또는 거절을 직접 골라야 해요."
          : isBlockedMode
            ? "필수 동의를 수락하지 않은 동안에는 일반 서비스 대신 이 동의 관리 화면을 이용할 수 있어요."
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
                  interactive={interactiveIds.has(document.id)}
                  choice={choices.get(document.id)}
                  completed={completed}
                  disabled={submitting || completed}
                  onChoiceChange={(choice) => updateChoice(document.id, choice)}
                />
              );
            })
          ) : (
            <p className="rounded-3xl border border-[#e5e8eb] bg-white p-6 text-sm text-[#4e5968]">
              현재 공개된 약관 문서가 없어요.
            </p>
          )}
        </div>

        {decisionDocuments.length > 0 ? (
          <>
            {submitError ? (
              <p className="mt-5 rounded-2xl bg-[#fff4f4] p-4 text-sm leading-6 text-[#d92d20]">
                {submitError}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={!canSubmit || submitting}
              className="mt-8 h-14 w-full rounded-2xl bg-[#3182f6] px-5 text-base font-semibold text-white transition hover:bg-[#1b64da] disabled:cursor-not-allowed disabled:bg-[#b0d2ff]"
            >
              {submitting
                ? "동의 내용을 확인하고 있어요"
                : verificationPending
                  ? "저장 결과 다시 확인하기"
                  : isBlockedMode
                    ? "변경사항 저장하기"
                    : "결정 저장하고 계속하기"}
            </button>
            {isDecisionMode ? (
              <p className="mt-4 text-center text-sm leading-6 text-[#8b95a1]">
                선택 항목도 체크하지 않은 상태를 거절로 간주하지 않아요.
              </p>
            ) : null}
          </>
        ) : nextPath ? (
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
  choice,
  completed,
  disabled,
  document,
  interactive,
  onChoiceChange,
}: {
  choice: ConsentChoice | undefined;
  completed: boolean;
  disabled: boolean;
  document: ConsentEntryDocument;
  interactive: boolean;
  onChoiceChange: (choice: ConsentChoice) => void;
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
          ) : document.current_decision ? (
            <span className="shrink-0 rounded-full bg-[#f2f4f6] px-3 py-1 text-xs font-semibold text-[#6b7684]">
              현재 {decisionLabel(document.current_decision)}
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
          <fieldset
            disabled={disabled}
            aria-describedby={bodyId}
            className="mt-5 space-y-3 disabled:opacity-60"
          >
            <legend className="text-sm font-semibold text-[#4e5968]">
              {document.required
                ? "서비스 이용을 위해 수락해 주세요."
                : "동의 여부를 직접 선택해 주세요."}
            </legend>
            <ChoiceRadio
              name={`consent-choice-${document.id}`}
              checked={choice === "granted"}
              label="동의해요"
              onChange={() => onChoiceChange("granted")}
            />
            {!document.required ? (
              <ChoiceRadio
                name={`consent-choice-${document.id}`}
                checked={choice === "declined"}
                label="동의하지 않아요"
                onChange={() => onChoiceChange("declined")}
              />
            ) : null}
          </fieldset>
        ) : null}
      </div>

      <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[#f2f4f6] bg-[#f9fafb] px-6 py-4 text-xs text-[#8b95a1]">
        <span>버전 {document.version}</span>
        <span>게시일 {formatPublishedAt(document.published_at)}</span>
      </footer>
    </article>
  );
}

function ChoiceRadio({
  checked,
  label,
  name,
  onChange,
}: {
  checked: boolean;
  label: string;
  name: string;
  onChange: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-[#e5e8eb] px-4 py-3 text-sm font-semibold text-[#4e5968] has-[:checked]:border-[#3182f6] has-[:checked]:bg-[#f2f7ff] has-[:disabled]:cursor-not-allowed">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="h-5 w-5 shrink-0 accent-[#3182f6]"
      />
      <span>{label}</span>
    </label>
  );
}

function decisionLabel(decision: ConsentEntryDocument["current_decision"]): string {
  if (decision === "granted") return "동의함";
  if (decision === "declined") return "동의하지 않음";
  if (decision === "revoked") return "철회함";
  return "미결정";
}

function formatPublishedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "long",
    timeZone: "Asia/Seoul",
  }).format(date);
}
