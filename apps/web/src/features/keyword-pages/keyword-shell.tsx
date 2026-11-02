import type { ReactNode } from "react";

import { SiteFooter, SiteHeader } from "@/features/site/site-chrome";

/**
 * 키워드 페이지와 블로그가 같이 쓰는 머리·꼬리. 사이트 공통 머리말·꼬리말을 그대로 쓴다.
 * 본문은 `children` 으로 받는다.
 */
export function KeywordShell({ children, current = "home" }: { children: ReactNode; current?: "home" | "blog" }) {
  return (
    <div className="flex min-h-dvh flex-col bg-white text-[#191f28]">
      <SiteHeader current={current} />
      <main className="min-w-0 flex-1">{children}</main>
      <SiteFooter showBadges={false} />
    </div>
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
