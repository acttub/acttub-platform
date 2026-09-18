import Image from "next/image";
import Link from "next/link";

import wordmark from "@/assets/acttub-wordmark.png";
import { StoreBadges } from "@/features/app-download/store-badges";
import type { KeywordPageContent } from "@/features/keyword-pages/types";

const relatedLinks = [
  {
    href: "/ai-acting-coaching",
    title: "AI 연기 코칭",
    description: "영상에서 확인한 단서로 질문을 받는 방법을 알아봐요.",
  },
  {
    href: "/acting-coaching",
    title: "연기 코칭 안내",
    description: "학원, 개인 레슨, 스터디와 혼자 하는 연습을 비교해요.",
  },
  {
    href: "/admissions",
    title: "연극영화과 입시 정보",
    description: "대학별 모집요강과 실기 일정을 확인해요.",
  },
] as const;

export function GuideIndexView({ guides }: { guides: readonly KeywordPageContent[] }) {
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

      <article className="mx-auto max-w-3xl px-5 pb-24 pt-14 sm:pt-20">
        <header>
          <p className="text-sm font-black text-[#3182f6]">연기 연습 가이드</p>
          <h1 className="mt-4 break-keep text-4xl font-black leading-[1.18] tracking-[-0.05em] sm:text-6xl">
            연기 연습 가이드
          </h1>
          <p className="mt-7 text-base font-semibold leading-8 text-[#4e5968] sm:text-lg">
            혼자 연습할 때 바로 꺼내 쓸 수 있는 순서와 질문을 모았어요.
          </p>
        </header>

        <ol className="mt-12 space-y-5">
          {guides.map((guide) => (
            <li key={guide.path}>
              <article className="rounded-3xl bg-[#f2f4f6] p-6 sm:p-8">
                <h2 className="break-keep text-2xl font-black tracking-[-0.04em] sm:text-3xl">
                  <Link href={guide.path} className="hover:text-[#3182f6]">
                    {guide.h1}
                  </Link>
                </h2>
                <p className="mt-4 leading-7 text-[#4e5968]">{guide.description}</p>
                <p className="mt-4 text-sm font-semibold text-[#8b95a1]">
                  업데이트 {guide.updatedAt}
                </p>
              </article>
            </li>
          ))}
        </ol>

        <section className="pt-16">
          <h2 className="text-3xl font-black tracking-[-0.04em]">함께 보기</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {relatedLinks.map((link) => (
              <Link key={link.href} href={link.href} className="rounded-3xl border border-[#d1d6db] p-5 hover:border-[#3182f6]">
                <h3 className="font-black">{link.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[#4e5968]">{link.description}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="mt-16 rounded-[32px] bg-[#191f28] p-7 text-white sm:p-10">
          <h2 className="break-keep text-3xl font-black leading-tight tracking-[-0.04em] sm:text-4xl">
            오늘 찍은 장면으로 바로 질문을 받아보세요
          </h2>
          <StoreBadges surface="keyword_page" className="mt-7" />
        </section>
      </article>

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
