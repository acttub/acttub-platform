"use client";

import { useState } from "react";

import { ConsentMarkdown } from "@/features/practice/consent-markdown";
import type { ConsentDocument, ConsentNotice } from "@/lib/api/v2/types";
import { useResource } from "@/lib/react/use-resource";

import { loadConsentDocumentsPage } from "./consent-documents";

/**
 * 동의 문서 공개 페이지(/terms). 누구에게나 모든 동의 문서의 현재 판 전문과 개인정보
 * 처리방침(고지) 전문을 보여 주고 결정 버튼이 없다 — 게스트 토큰이 있든 없든 같다
 * (account.consent). 결정은 기능 안의 시트에서만 받는다(consent-sheet.tsx). 판은 API 가
 * 주는 것을 그대로 그린다.
 */
export function ConsentDocumentsPage() {
  const [attempt, setAttempt] = useState(0);
  const documents = useResource(
    `consent-documents:${attempt}`,
    (_key, signal) => loadConsentDocumentsPage(signal),
    "약관 문서를 불러오지 못했어요.",
  );

  if (documents.state === "failed") {
    return (
      <TermsShell title="약관을 불러오지 못했어요">
        <p
          role="alert"
          className="rounded-2xl bg-[#fff4f4] p-4 text-sm leading-6 text-[#d92d20]"
        >
          {documents.message}
        </p>
        <button
          type="button"
          onClick={() => setAttempt((current) => current + 1)}
          className="mt-5 h-12 w-full rounded-2xl bg-[#3182f6] px-4 text-sm font-black text-white transition hover:bg-[#1b64da]"
        >
          다시 시도하기
        </button>
      </TermsShell>
    );
  }

  if (documents.state !== "ready") {
    return (
      <TermsShell title="약관을 확인하고 있어요">
        <p className="rounded-2xl bg-[#f2f4f6] p-4 text-sm text-[#4e5968]">
          필요한 문서를 불러오는 중이에요.
        </p>
      </TermsShell>
    );
  }

  return (
    <TermsShell
      title="약관 및 동의 문서"
      description="현재 제공 중인 약관과 데이터 처리 안내를 확인할 수 있어요."
    >
      <div className="space-y-5">
        {documents.data.documents.length > 0 ? (
          documents.data.documents.map((document) => (
            <ConsentDocumentCard key={document.id} document={document} />
          ))
        ) : (
          <p className="rounded-3xl border border-[#e5e8eb] bg-white p-6 text-sm text-[#4e5968]">
            현재 공개된 약관 문서가 없어요.
          </p>
        )}
        {documents.data.notices.map((notice) => (
          <ConsentNoticeCard key={notice.type} notice={notice} />
        ))}
      </div>
    </TermsShell>
  );
}

function TermsShell({
  children,
  description,
  title,
}: {
  children: React.ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl px-6 py-12 sm:py-16">
      <p className="text-sm font-semibold text-[#3182f6]">Acttub 약관</p>
      <h1 className="mt-3 text-3xl font-bold tracking-[-0.03em] text-[#191f28]">{title}</h1>
      {description ? (
        <p className="mt-3 max-w-2xl text-base leading-7 text-[#4e5968]">{description}</p>
      ) : null}
      <div className="mt-8">{children}</div>
    </main>
  );
}

function ConsentDocumentCard({ document }: { document: ConsentDocument }) {
  return (
    <article className="overflow-hidden rounded-3xl border border-[#e5e8eb] bg-white shadow-sm">
      <div className="p-6">
        <p className="text-xs font-semibold text-[#8b95a1]">
          {document.required ? "필수 동의" : "선택 동의"}
        </p>
        <h2 className="mt-1 text-lg font-bold tracking-[-0.02em] text-[#191f28]">
          {document.title}
        </h2>
        <div
          tabIndex={0}
          className="mt-5 max-h-64 overflow-y-auto rounded-2xl bg-[#f9fafb] p-4 outline-none focus:ring-2 focus:ring-[#90c2ff]"
        >
          <ConsentMarkdown source={document.body} />
        </div>
      </div>

      <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[#f2f4f6] bg-[#f9fafb] px-6 py-4 text-xs text-[#8b95a1]">
        <span>버전 {document.version}</span>
        <span>시행일 {formatPublishedAt(document.published_at)}</span>
      </footer>
    </article>
  );
}

/**
 * 개인정보 처리방침 같은 고지. 동의 문서가 아니라서 "필수·선택 동의" 꼬리표도 판·시행일도
 * 없다 — 서버가 주지 않는 값을 지어내 그리지 않는다(결정 I-6).
 */
function ConsentNoticeCard({ notice }: { notice: ConsentNotice }) {
  return (
    <article className="overflow-hidden rounded-3xl border border-[#e5e8eb] bg-white shadow-sm">
      <div className="p-6">
        <p className="text-xs font-semibold text-[#8b95a1]">안내</p>
        <h2 className="mt-1 text-lg font-bold tracking-[-0.02em] text-[#191f28]">
          {notice.title}
        </h2>
        <div
          tabIndex={0}
          className="mt-5 max-h-64 overflow-y-auto rounded-2xl bg-[#f9fafb] p-4 outline-none focus:ring-2 focus:ring-[#90c2ff]"
        >
          <ConsentMarkdown source={notice.body} />
        </div>
      </div>
    </article>
  );
}

// 시행일은 발행 시각이다. 문서는 발행하는 순간 효력이 생긴다(account.consent).
function formatPublishedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "long",
    timeZone: "Asia/Seoul",
  }).format(date);
}
