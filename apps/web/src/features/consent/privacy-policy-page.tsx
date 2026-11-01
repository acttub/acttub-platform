"use client";

import Link from "next/link";
import { useState } from "react";

import { ConsentMarkdown } from "@/features/consent/consent-markdown";
import { useResource } from "@/lib/react/use-resource";

import { loadPrivacyPolicy } from "./privacy-policy";

/**
 * 개인정보 처리방침 공개 페이지(/privacy). 스토어·푸터·앱이 가리키는 주소다. /terms 와 같은
 * 고지(GET /v2/consents/notices)를 받아 전문을 그대로 그린다. 정본은 서버의
 * consent-docs/privacy_policy.md 하나라서 웹에 사본을 두지 않는다.
 */
export function PrivacyPolicyPage() {
  const [attempt, setAttempt] = useState(0);
  const policy = useResource(
    `privacy-policy:${attempt}`,
    (_key, signal) => loadPrivacyPolicy(signal),
    "잠시 뒤 다시 시도해 주세요.",
  );

  if (policy.state === "failed") {
    return (
      <PrivacyShell title="개인정보 처리방침을 불러오지 못했어요">
        <p
          role="alert"
          className="rounded-2xl bg-[#fff4f4] p-4 text-sm leading-6 text-[#d92d20]"
        >
          {policy.message}
        </p>
        <button
          type="button"
          onClick={() => setAttempt((current) => current + 1)}
          className="mt-5 h-12 w-full rounded-2xl bg-[#3182f6] px-4 text-sm font-black text-white transition hover:bg-[#1b64da]"
        >
          다시 시도하기
        </button>
      </PrivacyShell>
    );
  }

  if (policy.state !== "ready") {
    return (
      <PrivacyShell title="개인정보 처리방침">
        <PrivacyPolicySkeleton />
      </PrivacyShell>
    );
  }

  return (
    <PrivacyShell title={policy.data.title}>
      <article className="rounded-3xl border border-[#e5e8eb] bg-white p-6 shadow-sm sm:p-8">
        <ConsentMarkdown source={policy.data.body} />
      </article>
      <p className="mt-6 text-sm text-[#6b7684]">
        이용약관과 동의 문서는{" "}
        <Link href="/terms" className="font-semibold text-[#3182f6] underline underline-offset-4">
          안전 약속
        </Link>
        에서 볼 수 있어요.
      </p>
    </PrivacyShell>
  );
}

function PrivacyShell({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl px-6 py-12 sm:py-16">
      <p className="text-sm font-semibold text-[#3182f6]">Acttub 안전 약속</p>
      <h1 className="mt-3 text-3xl font-bold tracking-[-0.03em] text-[#191f28]">{title}</h1>
      <div className="mt-8">{children}</div>
    </main>
  );
}

const SKELETON_LINES = ["w-11/12", "w-full", "w-4/5", "w-full", "w-3/5", "w-10/12", "w-full", "w-2/3"];

/** 본문 자리를 미리 잡아 둔다. 문구 대신 모양만 보이고, 화면 낭독기에는 불러오는 중이라고 알린다. */
function PrivacyPolicySkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="개인정보 처리방침을 불러오는 중"
      data-testid="privacy-policy-skeleton"
      className="rounded-3xl border border-[#e5e8eb] bg-white p-6 shadow-sm sm:p-8"
    >
      <div className="animate-pulse space-y-6">
        {[0, 1].map((section) => (
          <div key={section} className="space-y-3">
            <div className="h-5 w-1/3 rounded-lg bg-[#eef1f4]" />
            {SKELETON_LINES.slice(section * 3, section * 3 + 5).map((width, index) => (
              <div key={index} className={`h-3.5 rounded-md bg-[#f2f4f6] ${width}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
