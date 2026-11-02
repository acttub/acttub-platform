"use client";

import Image from "next/image";

import { useAppDownloadHref } from "@/features/app-download/app-download-button";
import { StoreBadges } from "@/features/app-download/store-badges";
import { useCampaignSearch } from "@/features/app-download/use-campaign-search";
import { SiteFooter, SiteHeader } from "@/features/site/site-chrome";
import { SiteLink } from "@/features/site/site-link";
import {
  COACHING_TRIAL_PATH,
  READING_TRIAL_PATH,
  trialHref,
} from "@/features/trial/trial-paths";

// 인스타그램 프로필 링크와 네이버 검색광고가 이 주소를 가리킨다.
// 사진·앱 화면 없이 글과 QR만 둔다. 컴퓨터에서는 QR과 두 스토어 배지, 폰에서는 큰 버튼 하나로
// 설치까지 닿게 하고, 설치 전에 써 보고 싶은 사람에게는 가입 없이 해 보는 웹 체험을 건넨다(SOMA-834).
// 스토어 배지는 `/go/<os>/app_page` 로 나가므로 UTM 귀속과 클릭 집계 이벤트가 그대로 이어진다.

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3182f6]";

const COLUMNS = [
  {
    kicker: "대본 리딩",
    title: ["상대 대사는 AI가 읽고,", "내 차례엔 멈춰 기다려요"],
    body: "대본을 넣고 내 배역만 고르면 돼요. 내 대사는 가려 두고 외운 대로 말해 봐요.",
    trial: READING_TRIAL_PATH,
  },
  {
    kicker: "연기 코칭",
    title: ["영상을 올리면", "코치가 보고 물어봐요"],
    body: "정답을 알려 주지 않아요. 질문에 답하다 보면 내가 무엇을 하고 있었는지 보여요.",
    trial: COACHING_TRIAL_PATH,
  },
  {
    kicker: "대사 챌린지",
    title: ["매주 같은 대사를", "다른 배우들과 해 봐요"],
    body: "같은 한 줄을 사람마다 어떻게 하는지 보고 내 영상도 올려요. 챌린지는 앱에서만 돼요.",
    trial: null,
  },
] as const;

export default function AppDownloadView() {
  const search = useCampaignSearch();
  const mobileHref = useAppDownloadHref("app_page");
  const readingHref = trialHref(READING_TRIAL_PATH, "app_page", search);

  return (
    <div className="flex min-h-dvh flex-col bg-white text-[#191f28]">
      <SiteHeader current="home" />

      <main className="flex-1">
        <section className="mx-auto flex max-w-[1200px] flex-col items-center px-5 pb-14 pt-12 text-center sm:px-8 md:pb-20 md:pt-20">
          <Image
            src="/site/app-icon.png"
            alt="액터브 앱 아이콘"
            width={96}
            height={96}
            priority
            className="h-20 w-20 rounded-[22px] md:h-24 md:w-24 md:rounded-[26px]"
          />
          <p className="mt-5 text-sm font-bold text-[#4e5968]">액터브 · iPhone · Android 무료</p>
          <h1 className="mt-3 text-[28px] font-extrabold leading-[1.3] tracking-[-0.03em] md:text-[44px] md:leading-[1.25]">
            혼자 하는 연기 연습,
            <br />
            앱에서 매일 이어 가요
          </h1>
          <p className="mt-4 max-w-md text-[15px] leading-[1.7] text-[#4e5968] md:max-w-none md:text-lg">
            상대역은 AI가 읽어 주고, 연기 영상은 코치가 보고 물어봐요.
          </p>

          {/* 컴퓨터: QR 카드 */}
          <div className="mt-9 hidden items-center gap-5 rounded-[22px] border border-[#e5e8eb] bg-white p-5 text-left md:flex">
            <Image
              src="/site/app-qr.svg"
              alt="앱 설치 QR 코드"
              width={120}
              height={120}
              unoptimized
              className="shrink-0"
            />
            <div>
              <p className="text-lg font-extrabold">휴대폰 카메라로 찍으세요</p>
              <p className="mt-1 text-sm text-[#8b95a1]">설치 화면으로 바로 가요</p>
              <StoreBadges surface="app_page" size="md" className="mt-4" />
            </div>
          </div>

          {/* 폰: 기기에 맞는 스토어로 가는 큰 버튼 하나 */}
          <div className="mt-8 w-full max-w-sm md:hidden">
            <a
              href={mobileHref}
              data-app-download="app_page"
              className={`flex h-14 w-full items-center justify-center rounded-2xl bg-[#3182f6] text-base font-bold text-white transition hover:bg-[#1b64da] ${FOCUS}`}
            >
              앱 받기
            </a>
            <SiteLink
              href={readingHref}
              className={`mt-4 inline-block rounded text-sm font-semibold text-[#4e5968] underline underline-offset-4 ${FOCUS}`}
            >
              웹에서 먼저 해 보기
            </SiteLink>
          </div>

          <p className="mt-6 hidden text-sm text-[#6b7684] md:block">
            설치 전에 먼저 해 보고 싶다면 ·{" "}
            <SiteLink
              href={readingHref}
              className={`rounded font-bold text-[#191f28] underline underline-offset-4 ${FOCUS}`}
            >
              웹에서 리딩 해 보기
            </SiteLink>
          </p>
        </section>

        <section className="mx-auto max-w-[1200px] px-5 sm:px-8">
          <div className="grid border-t border-[#e5e8eb] md:grid-cols-3">
            {COLUMNS.map((column, index) => (
              <div
                key={column.kicker}
                className={`py-8 md:py-10 ${index > 0 ? "border-t border-[#e5e8eb] md:border-l md:border-t-0" : ""} ${index > 0 ? "md:pl-10" : ""} ${index < COLUMNS.length - 1 ? "md:pr-10" : ""}`}
              >
                <p className="text-[13px] font-bold text-[#3182f6]">{column.kicker}</p>
                <h2 className="mt-3 text-xl font-extrabold leading-[1.45] tracking-[-0.02em]">
                  {column.title[0]}
                  <br className="hidden md:block" /> {column.title[1]}
                </h2>
                <p className="mt-3 text-[15px] leading-[1.7] text-[#6b7684]">{column.body}</p>
                {column.trial ? (
                  <SiteLink
                    href={trialHref(column.trial, "app_page", search)}
                    className={`mt-5 inline-block rounded text-[15px] font-bold text-[#191f28] underline underline-offset-4 ${FOCUS}`}
                  >
                    웹에서 먼저 해 보기
                  </SiteLink>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-[1200px] px-5 pb-16 pt-2 sm:px-8 md:pb-24">
          <p className="border-t border-[#edf0f3] pt-6 text-sm leading-[1.7] text-[#4e5968]">
            <strong className="font-bold text-[#191f28]">무료로 쓸 수 있나요?</strong>{" "}
            네, 무료로 연습할 수 있어요. 더 쓰려면 Pro(월 3,900원)가 있어요.
          </p>
        </section>
      </main>

      <SiteFooter showBadges={false} />
    </div>
  );
}
