"use client";

import Image from "next/image";
import { SiteLink } from "@/features/site/site-link";

import { StoreBadges } from "@/features/app-download/store-badges";
import { useCampaignSearch } from "@/features/app-download/use-campaign-search";
import { COACHING_TRIAL_PATH, READING_TRIAL_PATH, trialHref } from "./trial-paths";

/**
 * 홈 첫 화면의 체험 카드 둘과 QR 줄(SOMA-834 3차). 앱을 깔기 전에 「해 보기」를 먼저 둔다.
 * 리딩은 준비물이 없어서 첫 번째, 코칭은 영상이 있어야 해서 두 번째다.
 * 휴대폰 너비에서는 QR 대신 스토어 배지를 둔다.
 */
export const HOME_TRIAL_CARDS = {
  reading: {
    kicker: "준비물 없음 · 3분",
    title: "상대역 리딩 해 보기",
    body: "예시 대본이 들어 있어요. 상대역은 AI가 읽어요.",
    button: "바로 시작",
  },
  coaching: {
    kicker: "연기 영상 하나",
    title: "연기 질문 받아 보기",
    body: "영상을 올리면 코치가 장면을 보고 물어봐요.",
    button: "영상 올리기",
  },
} as const;

export const HOME_QR_COPY = "앱으로 하려면 휴대폰 카메라로 찍으세요";
export const HOME_QR_NOTE = "iPhone · Android 무료";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4880ee]";

export function HomeTrialCards() {
  const search = useCampaignSearch();
  const reading = HOME_TRIAL_CARDS.reading;
  const coaching = HOME_TRIAL_CARDS.coaching;
  return (
    <div className="mt-8 lg:mt-10">
      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
        <div className="flex flex-col rounded-[28px] bg-[#191f28] p-6 text-white sm:p-7">
          <p className="text-[13px] font-bold text-[#9ec5ff]">{reading.kicker}</p>
          <h2 className="mt-2 text-[22px] font-extrabold tracking-[-0.03em] sm:text-2xl">{reading.title}</h2>
          <p className="mt-2 text-[15px] leading-[1.6] text-[#d1d6db]">{reading.body}</p>
          <SiteLink
            href={trialHref(READING_TRIAL_PATH, "home_card", search)}
            className={`mt-6 inline-flex h-12 w-fit items-center rounded-[14px] bg-[#3182f6] px-6 text-[15px] font-bold text-white transition hover:bg-[#1b64da] ${FOCUS}`}
          >
            {reading.button}
          </SiteLink>
        </div>
        <div className="flex flex-col rounded-[28px] bg-[#f2f4f6] p-6 sm:p-7">
          <p className="text-[13px] font-bold text-[#6b7684]">{coaching.kicker}</p>
          <h2 className="mt-2 text-[22px] font-extrabold tracking-[-0.03em] sm:text-2xl">{coaching.title}</h2>
          <p className="mt-2 text-[15px] leading-[1.6] text-[#4e5968]">{coaching.body}</p>
          <SiteLink
            href={trialHref(COACHING_TRIAL_PATH, "home_card", search)}
            className={`mt-6 inline-flex h-12 w-fit items-center rounded-[14px] border border-[#e5e8eb] bg-white px-6 text-[15px] font-bold text-[#191f28] transition hover:bg-[#f9fafb] ${FOCUS}`}
          >
            {coaching.button}
          </SiteLink>
        </div>
      </div>

      <div className="mt-6 hidden items-center gap-3.5 lg:flex">
        <Image
          src="/site/app-qr.svg"
          alt="앱 설치 QR 코드"
          width={56}
          height={56}
          unoptimized
          className="rounded-lg border border-[#e5e8eb] bg-white p-1"
        />
        <p className="text-sm leading-[1.65] text-[#6b7684]">
          {HOME_QR_COPY} · {HOME_QR_NOTE}
        </p>
      </div>
      <div className="mt-5 lg:hidden">
        <p className="text-[13px] text-[#8b95a1]">앱으로 하려면 · {HOME_QR_NOTE}</p>
        <StoreBadges surface="landing_hero" className="mt-2" />
      </div>
    </div>
  );
}
