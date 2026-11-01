"use client";

import { SiteLink } from "@/features/site/site-link";

import { useCampaignSearch } from "@/features/app-download/use-campaign-search";
import { READING_TRIAL_PATH, trialHref } from "./trial-paths";

/**
 * 연기 코칭 시작 화면(영상 올리기)의 체험 안내(SOMA-834 3차). 제목과 한 줄 설명, 오른쪽의 질문 예시,
 * 영상이 없는 사람을 리딩 체험으로 보내는 링크. 질문 예시는 실제 앱 대화를 옮긴 것이다.
 */
export const COACHING_INTRO_COPY = {
  title: ["연기 영상을 올리면", "코치가 보고 물어봐요"],
  sub: "정답을 알려 주지 않아요. 내가 장면을 다시 보게 질문해요.",
  examplesLabel: "이런 질문을 받아요",
  examplesNote: "실제 앱 대화를 옮긴 예시예요.",
  noVideo: "찍어 둔 영상이 없나요?",
  readingLink: "상대역 리딩부터 해 보기",
} as const;

export const COACHING_EXAMPLE_BUBBLES = [
  { from: "coach", text: "「우리 그만하자」 뒤에 2초 멈췄어요. 그 2초 동안 서연은 무엇을 결심하고 있었을까요?" },
  { from: "actor", text: "헤어지기로 마음먹고 있었던 것 같아요" },
  { from: "coach", text: "결심이 섰다면, 마지막 대사는 어떻게 달라질까요?" },
] as const;

export function CoachingIntroHeading() {
  return (
    <div>
      <h1 className="text-[28px] font-extrabold leading-[1.3] tracking-[-0.04em] sm:text-[34px]">
        {COACHING_INTRO_COPY.title[0]}
        <br />
        {COACHING_INTRO_COPY.title[1]}
      </h1>
      <p className="mt-2 text-[15px] leading-6 text-[#4e5968]">{COACHING_INTRO_COPY.sub}</p>
    </div>
  );
}

export function CoachingExamples() {
  return (
    <section aria-label={COACHING_INTRO_COPY.examplesLabel} className="mt-6 lg:mt-0">
      <p className="text-[13px] font-bold text-[#8b95a1]">{COACHING_INTRO_COPY.examplesLabel}</p>
      <ul className="mt-3 flex flex-col gap-2.5">
        {COACHING_EXAMPLE_BUBBLES.map((bubble) => (
          <li
            key={bubble.text}
            className={
              bubble.from === "actor"
                ? "ml-10 rounded-[20px] bg-[#3182f6] px-4 py-3 text-[15px] leading-6 text-white"
                : "mr-4 rounded-[20px] bg-[#f2f4f6] px-4 py-3 text-[15px] leading-6 text-[#191f28]"
            }
          >
            {bubble.text}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12.5px] text-[#8b95a1]">{COACHING_INTRO_COPY.examplesNote}</p>
    </section>
  );
}

/** 업로드 영역 아래의 작은 안내. 영상이 없는 사람은 리딩 체험으로 간다. */
export function NoVideoReadingLink() {
  const search = useCampaignSearch();
  return (
    <p className="text-[14px] text-[#4e5968]">
      {COACHING_INTRO_COPY.noVideo}{" "}
      <SiteLink href={trialHref(READING_TRIAL_PATH, "coaching_link", search)} className="font-bold text-[#191f28] underline underline-offset-2">
        {COACHING_INTRO_COPY.readingLink}
      </SiteLink>
    </p>
  );
}
