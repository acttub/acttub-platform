"use client";

import Link from "next/link";

import { useAppDownloadHref } from "@/features/app-download/app-download-button";
import { StoreBadges } from "@/features/app-download/store-badges";

import { Acty, FOCUS_ON_DARK, Grain, Phone, PRIMARY_BUTTON, Qr, SERIF } from "./shared";

/**
 * 첫 화면. 먹색 무대에 핀 조명 하나가 앱 화면을 비추고, 액티는 그 발치에서 작게 인사한다.
 * 조명은 이 구간에만 있다. 나머지 구간은 빛 없이 바탕만 깐다.
 */
export function LandingHero({
  returningGuest,
  webHref,
  homeHref,
}: {
  returningGuest: boolean;
  webHref: string;
  homeHref: string;
}) {
  const appHref = useAppDownloadHref("landing_hero");

  return (
    <section id="hero" className="relative overflow-hidden bg-[#14110e] text-[#f2ebe0]">
      {/* 핀 조명: 위에서 내려오는 빛줄기와 바닥에 고이는 빛 */}
      <div aria-hidden="true" className="landing-spot pointer-events-none absolute inset-0" />
      <Grain />

      <div className="relative mx-auto grid max-w-[1200px] gap-12 px-6 pt-14 sm:px-8 lg:min-h-[min(calc(100dvh-72px),840px)] lg:grid-cols-[minmax(0,1fr)_440px] lg:items-center lg:gap-16 lg:pb-0 lg:pt-0">
        <div className="relative z-10 lg:pb-6">
          <h1 data-enter className={`${SERIF} text-[clamp(40px,5.6vw,74px)] leading-[1.16]`}>
            찍고, 답하고,
            <br />
            다음 테이크로.
          </h1>
          <p
            data-enter
            style={{ "--d": "80ms" } as React.CSSProperties}
            className="mt-6 max-w-[30em] text-[17px] leading-[1.7] text-[#b8ad9e] sm:text-[18px]"
          >
            연기 영상을 올리면 AI 코치가 장면을 보고 질문해요. 답하다 보면 다음 테이크에서 해 볼 것이 하나 정해져요.
          </p>

          <div data-enter style={{ "--d": "160ms" } as React.CSSProperties} className="mt-10">
            <a
              href={appHref}
              data-app-download="landing_hero"
              className={`${PRIMARY_BUTTON} w-full sm:w-auto lg:hidden`}
            >
              앱 열기 · 무료로 설치
            </a>

            <div className="hidden items-center gap-5 lg:flex">
              <Qr size={92} />
              <div>
                <p className="text-[15px] text-[#b8ad9e]">휴대폰 카메라로 찍으면 설치 화면으로 가요</p>
                <StoreBadges surface="landing_hero" className="mt-3" />
              </div>
            </div>

            <p className="mt-6 text-[15px] text-[#b8ad9e]">
              {returningGuest ? "이 브라우저에서 하던 연습이 있어요. " : "설치 전에 "}
              <Link
                href={returningGuest ? homeHref : webHref}
                className={`rounded-sm text-[#f2ebe0] underline decoration-[#f2ebe0]/40 underline-offset-[5px] transition-colors hover:decoration-[#f2ebe0] ${FOCUS_ON_DARK}`}
              >
                {returningGuest ? "이어서 연습하기 →" : "웹에서 먼저 해 보기 →"}
              </Link>
            </p>
          </div>
        </div>

        {/* 무대: 조명 받는 휴대폰 한 대, 그 발치의 액티 */}
        <div className="relative mx-auto h-[500px] w-full max-w-[360px] sm:h-[600px] lg:h-[700px] lg:max-w-none">
          <div aria-hidden="true" className="landing-beam pointer-events-none absolute left-1/2 top-[-120px] h-[620px] w-[460px] -translate-x-1/2 sm:h-[720px] lg:top-[-200px] lg:h-[920px] lg:w-[620px]" />
          <div aria-hidden="true" className="landing-floor pointer-events-none absolute bottom-[10px] left-1/2 h-[110px] w-[440px] -translate-x-1/2 lg:bottom-[22px] lg:h-[120px] lg:w-[640px]" />
          <div className="absolute left-1/2 top-[20px] w-[200px] -translate-x-1/2 sm:w-[240px] lg:top-[56px] lg:w-[280px]">
            <Phone src="/site/shot-coach.jpg" alt="앱의 코칭 질문 대화 화면" priority />
          </div>
          <div
            data-enter
            style={{ "--d": "240ms" } as React.CSSProperties}
            className="absolute bottom-[50px] left-[max(0px,calc(50%-176px))] w-[70px] sm:bottom-[30px] sm:left-[calc(50%-214px)] sm:w-[96px] lg:bottom-[40px] lg:left-[calc(50%-290px)] lg:w-[118px]"
          >
            <Acty pose="stage-bow" width={118} alt="인사하는 액티, 액터브의 캐릭터" priority className="w-full" />
          </div>
        </div>
      </div>
    </section>
  );
}
