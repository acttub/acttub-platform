import Link from "next/link";

import { StoreBadges } from "@/features/app-download/store-badges";
import { ClosingCta, KeywordShell } from "@/features/keyword-pages/keyword-shell";
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
    <KeywordShell>
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

        <ClosingCta>
          <StoreBadges surface="keyword_page" className="mt-7" />
        </ClosingCta>
      </article>
    </KeywordShell>
  );
}
