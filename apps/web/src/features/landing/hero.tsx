"use client";

import Link from "next/link";

import { useAppDownloadHref } from "@/features/app-download/app-download-button";
import { StoreBadges } from "@/features/app-download/store-badges";

import { Acty, FOCUS_ON_DARK, Phone, Qr } from "./shared";

/**
 * 첫 화면. 큰 글자가 그림 역할을 하고, 액티가 주인공이다.
 * 아래쪽 휴대폰은 화면 밑에서 올라오는 것처럼 잘라 보여 준다.
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
    <section id="hero" className="relative overflow-hidden bg-[#151a30] text-white">
      <div className="relative mx-auto flex max-w-[1200px] flex-col items-center px-5 pt-8 text-center sm:px-8 lg:pt-14">
        <div
          data-enter="pop"
          style={{ "--d": "120ms" } as React.CSSProperties}
          className="mb-3 lg:absolute lg:right-[-10px] lg:top-[110px] lg:mb-0 lg:rotate-[6deg]"
        >
          <Acty name="home" alt="액티, 액터브의 캐릭터" size={280} priority className="w-[112px] sm:w-[140px] lg:w-[250px]" />
        </div>
        <p data-enter style={{ "--d": "0ms" } as React.CSSProperties} className="rounded-full border border-white/25 px-4 py-2 text-sm font-bold text-[#ffd9a0] sm:text-[15px]">
          혼자 연습하는 배우를 위한 AI 코치, 액터브
        </p>
        <h1
          data-enter
          style={{ "--d": "80ms" } as React.CSSProperties}
          className="mt-6 text-[clamp(44px,12.5vw,104px)] font-black leading-[1.05] tracking-[-0.06em]"
        >
          찍어 올리면
          <br />
          <span className="text-[#ffa21f]">코치가 물어봐요</span>
        </h1>
        <p
          data-enter
          style={{ "--d": "160ms" } as React.CSSProperties}
          className="mt-6 max-w-[620px] text-lg leading-[1.6] text-[#d5d9e6] sm:text-xl"
        >
          연기 영상을 올리면 코치가 장면을 보고 질문해요. 대본을 넣으면 상대역 대사를 AI 음성이 읽어 줘요.
        </p>

        <div data-enter style={{ "--d": "240ms" } as React.CSSProperties} className="mt-9 flex w-full flex-col items-center gap-5">
          <a
            href={appHref}
            data-app-download="landing_hero"
            className={`flex h-16 w-full max-w-[420px] items-center justify-center rounded-full bg-[#ffa21f] text-lg font-extrabold text-[#151a30] transition hover:bg-[#ffb347] lg:hidden ${FOCUS_ON_DARK}`}
          >
            앱 열기 · 무료로 설치
          </a>

          <div className="hidden items-center gap-6 rounded-[28px] bg-white p-5 pr-8 text-left text-[#191f28] lg:flex">
            <Qr size={116} />
            <div>
              <p className="text-lg font-extrabold">휴대폰 카메라로 찍으면 설치 화면으로 가요</p>
              <p className="mt-1 text-sm text-[#4e5968]">iPhone · Android 무료</p>
              <StoreBadges surface="landing_hero" className="mt-3" />
            </div>
          </div>

          <p className="text-[15px] font-semibold text-[#d5d9e6] lg:text-base">
            {returningGuest ? "이 브라우저에서 하던 연습이 있어요 " : "설치 전에 "}
            <Link
              href={returningGuest ? homeHref : webHref}
              className={`rounded font-bold text-[#ffd9a0] underline underline-offset-4 ${FOCUS_ON_DARK}`}
            >
              {returningGuest ? "이어서 연습하기 →" : "웹에서 먼저 해 보기 →"}
            </Link>
          </p>
        </div>
      </div>

      {/* 휴대폰은 윗부분만 보이게 자른다. */}
      <div className="relative mx-auto mt-10 h-[300px] max-w-[1200px] sm:h-[400px] lg:h-[330px]">
        <div className="absolute left-1/2 top-0 w-[250px] -translate-x-1/2 sm:w-[300px] lg:w-[340px]">
          <Phone src="/site/shot-coach.jpg" alt="앱의 코칭 질문 대화 화면" priority />
        </div>
        <div className="absolute left-1/2 top-[60px] hidden w-[270px] translate-x-[110px] rotate-[5deg] lg:block">
          <Phone src="/site/shot-reading.jpg" alt="앱의 대본 리딩 화면" />
        </div>
      </div>
    </section>
  );
}
