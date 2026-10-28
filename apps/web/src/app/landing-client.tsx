"use client";

import { useEffect, useSyncExternalStore } from "react";

import { StickyDownloadBar } from "@/features/app-download/sticky-download-bar";
import { useCampaignSearch } from "@/features/app-download/use-campaign-search";
import { DownloadBand } from "@/features/landing/download-band";
import { FaqSection } from "@/features/landing/faq-section";
import { ChallengeSection, CoachingSection, ReadingSection } from "@/features/landing/feature-sections";
import { LandingHero } from "@/features/landing/hero";
import { PricingSection } from "@/features/landing/pricing-section";
import { VerbBand } from "@/features/landing/verb-band";
import { SiteFooter, SiteHeader } from "@/features/site/site-chrome";
import { preserveWebAttributionFromSearch } from "@/lib/analytics/web-attribution";
import { hasGuestSession, subscribeAuthChange } from "@/lib/auth/token-store";

/**
 * 공개 홈(/). SOMA-918 개편: 큰 글자와 액티가 첫 화면을 이끌고, 코칭·리딩·챌린지는 서로 다른 짜임으로 보여 준다.
 * 구간은 src/features/landing 에 하나씩 나뉘어 있어 따로 고칠 수 있다.
 * 앱 받기 링크·QR·스토어 배지는 기존 다운로드 경로(useAppDownloadHref, StoreBadges, 클릭 가로채기)를 그대로 쓴다.
 */
export default function LandingClient() {
  const campaignSearch = useCampaignSearch();
  const practiceHref = preserveWebAttributionFromSearch("/practice/new", campaignSearch);
  const readingHref = preserveWebAttributionFromSearch("/reading", campaignSearch);
  const homeHref = preserveWebAttributionFromSearch("/home", campaignSearch);
  // 이 브라우저에서 연습하던 게스트도 홈(/)을 그대로 본다. 대신 첫 화면 링크를 「이어서 연습하기」로 바꿔 준다.
  // 서버 렌더에서는 게스트가 없다고 보고, 브라우저에서 저장소를 읽어 바꾼다.
  const returningGuest = useSyncExternalStore(subscribeAuthChange, hasGuestSession, () => false);

  // 아래 구간(data-reveal)은 화면에 들어올 때 스르륵 나타난다. 강제 스크롤은 쓰지 않는다.
  // 숨김은 이 효과가 붙은 뒤(html.reveal-ready)에만 걸어서, 스크립트가 늦거나 없으면 그냥 보인다.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const root = document.documentElement;
    const targets = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.shown = "";
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    for (const el of targets) observer.observe(el);
    root.classList.add("reveal-ready");
    return () => {
      observer.disconnect();
      root.classList.remove("reveal-ready");
    };
  }, []);

  return (
    <div className="min-h-dvh break-keep bg-white text-[#191f28]">
      <SiteHeader current="home" />
      <main>
        <LandingHero returningGuest={returningGuest} webHref={practiceHref} homeHref={homeHref} />
        <VerbBand />
        <CoachingSection webHref={practiceHref} />
        <ReadingSection webHref={readingHref} />
        <ChallengeSection />
        <PricingSection />
        <FaqSection />
      </main>
      <DownloadBand />
      <SiteFooter showBadges={false} />
      <StickyDownloadBar heroId="hero" />
    </div>
  );
}
