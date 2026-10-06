import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import wordmark from "@/assets/acttub-wordmark.png";

/** 키워드 페이지와 가이드 목차가 같이 쓰는 머리·꼬리. 본문은 `children` 으로 받는다. */
export function KeywordShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-white text-[#191f28]">
      <header className="border-b border-[#edf0f3]/80 px-5">
        <nav className="mx-auto flex h-16 max-w-5xl items-center justify-between">
          <Link href="/" aria-label="Acttub 홈">
            <Image src={wordmark} alt="Acttub" priority className="h-6 w-auto" />
          </Link>
          <Link href="/app" className="text-sm font-bold text-[#4e5968] hover:text-[#191f28]">
            앱 다운로드
          </Link>
        </nav>
      </header>

      {children}

      <footer className="border-t border-[#edf0f3] px-5 py-12">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm font-semibold leading-6 text-[#4e5968]">
            Acttub은 질문으로 연기 장면을 다시 생각하는 연기 연습 도구예요.
          </p>
          <nav className="mt-5 flex flex-wrap gap-x-6 gap-y-3 text-sm font-bold text-[#6b7684]">
            <Link href="/">홈</Link>
            <Link href="/app">앱 다운로드</Link>
            <Link href="/guide">연기 연습 가이드</Link>
            <Link href="/ai-acting-coaching">AI 연기 코칭</Link>
            <Link href="/acting-coaching">연기 코칭 안내</Link>
            <Link href="/terms">안전 약속</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}

/** 본문 끝의 어두운 시작 권유. 무엇으로 시작하게 할지는 페이지가 `children` 으로 준다. */
export function ClosingCta({ children }: { children: ReactNode }) {
  return (
    <section className="mt-16 rounded-[32px] bg-[#191f28] p-7 text-white sm:p-10">
      <h2 className="break-keep text-3xl font-black leading-tight tracking-[-0.04em] sm:text-4xl">
        오늘 찍은 장면으로 바로 질문을 받아보세요
      </h2>
      {children}
    </section>
  );
}
