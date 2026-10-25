"use client";

import Image from "next/image";
import Link from "next/link";
import { useSyncExternalStore } from "react";

import { useAppDownloadHref } from "@/features/app-download/app-download-button";
import { StickyDownloadBar } from "@/features/app-download/sticky-download-bar";
import { StoreBadges } from "@/features/app-download/store-badges";
import { useCampaignSearch } from "@/features/app-download/use-campaign-search";
import { findFaq, PAYMENT_START_NOTICE } from "@/features/help/help-content";
import { SiteFooter, SiteHeader } from "@/features/site/site-chrome";
import { preserveWebAttributionFromSearch } from "@/lib/analytics/web-attribution";
import { hasGuestSession, subscribeAuthChange } from "@/lib/auth/token-store";

/**
 * 공개 홈(/). 앱을 쓰게 하는 소개와, 웹이 공식 창구라는 것을 함께 보인다(SOMA-834 웹 개편 v2).
 * 앱 화면은 휴대폰 안 시연으로만 쓰고 앱 탭 구조를 옮기지 않는다. 문구는 이미 공개한 사실만 쓴다.
 */
const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4880ee]";

const HOME_FAQ = [
  "웹에서도 앱 계정으로 쓸 수 있나요?",
  "무료로 쓰다가 자동으로 유료가 되나요?",
  "어떤 영상을 올릴 수 있나요?",
  "해지하면 바로 Pro를 못 쓰나요?",
  "리딩에는 어떤 대본을 넣을 수 있나요?",
] as const;

function Phone({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return (
    <div className={`rounded-[44px] bg-[#111] p-2.5 shadow-[0_30px_60px_rgba(25,31,40,0.22)] ${className}`}>
      <Image src={src} alt={alt} width={390} height={844} className="block h-auto w-full rounded-[34px] bg-white" />
    </div>
  );
}

function Qr({ size }: { size: number }) {
  return (
    <Image
      src="/site/app-qr.svg"
      alt="앱 설치 QR 코드"
      width={size}
      height={size}
      unoptimized
      className="rounded-xl border border-[#e5e8eb] bg-white p-2"
    />
  );
}

type Feature = {
  id: string;
  kicker: string;
  title: [string, string];
  body: string;
  bullets: string[];
  appLabel: string;
  web?: { href: string; label: string };
  shot: string;
  shotAlt: string;
};

export default function LandingClient() {
  const campaignSearch = useCampaignSearch();
  const practiceHref = preserveWebAttributionFromSearch("/practice/new", campaignSearch);
  const readingHref = preserveWebAttributionFromSearch("/reading", campaignSearch);
  const homeHref = preserveWebAttributionFromSearch("/home", campaignSearch);
  const appHref = useAppDownloadHref("landing_hero");
  const appSectionHref = useAppDownloadHref("landing_app_section");
  // 이 브라우저에서 연습하던 게스트도 홈(/)을 그대로 본다. 예전에는 /home 으로 바로 넘겨서
  // 다시 온 사람이 새 소개 화면을 못 봤다. 대신 첫 화면 링크를 「이어서 연습하기」로 바꿔 준다.
  // 서버 렌더에서는 게스트가 없다고 보고, 브라우저에서 저장소를 읽어 바꾼다.
  const returningGuest = useSyncExternalStore(subscribeAuthChange, hasGuestSession, () => false);

  const features: Feature[] = [
    {
      id: "coaching",
      kicker: "연기 코칭",
      title: ["단정하지 않고,", "장면을 같이 봐요"],
      body: "찍어 둔 연기 영상을 올리면 코치가 장면을 보고 질문해요. 답하다 보면 막힌 곳이 보이고, 대화가 끝나면 연습 노트가 남아요.",
      bullets: ["영상 없이 말로 고민을 털어놔도 돼요", "다음 테이크에서 해 볼 것 하나를 정해 줘요"],
      appLabel: "앱에서 코칭 받기",
      web: { href: practiceHref, label: "웹에서 해 보기" },
      shot: "/site/shot-note.jpg",
      shotAlt: "앱의 연습 노트 화면",
    },
    {
      id: "reading",
      kicker: "대본 리딩",
      title: ["혼자여도,", "대사는 오가요"],
      body: "대본을 넣고 내 배역을 고르면 상대역 대사를 AI가 소리 내 읽어 줘요. 내 대사는 가리고 호흡을 맞춰 봐요.",
      bullets: ["TXT·DOCX·PDF·HWP 파일이나 붙여넣기로 넣어요", "예시 대본으로 바로 시작할 수도 있어요"],
      appLabel: "앱에서 리딩하기",
      web: { href: readingHref, label: "웹에서 해 보기" },
      shot: "/site/shot-reading.jpg",
      shotAlt: "앱의 대본 리딩 화면",
    },
    {
      id: "challenge",
      kicker: "챌린지",
      title: ["이번 주 대사,", "다른 배우는 어떻게 했을까"],
      body: "매주 공식 대사가 열려요. 같은 대사를 다른 배우들이 어떻게 연기했는지 보고, 나도 찍어서 올려요.",
      bullets: ["참여·좋아요·댓글은 앱에서 해요"],
      appLabel: "앱에서 참여하기",
      shot: "/site/shot-challenge.jpg",
      shotAlt: "앱의 챌린지 화면",
    },
  ];

  const faq = HOME_FAQ.map((q) => findFaq(q)).filter((item) => item !== undefined);

  return (
    <div className="min-h-dvh break-keep bg-white text-[#191f28]">
      <SiteHeader current="home" />
      <main>
        <section id="hero" className="bg-gradient-to-b from-white to-[#f5f9ff]">
          <div className="mx-auto flex max-w-[1200px] flex-col items-center gap-12 px-5 pb-0 pt-10 sm:px-8 lg:flex-row lg:gap-16 lg:pb-16 lg:pt-[72px]">
            <div className="w-full flex-1">
              <p className="inline-flex rounded-full bg-[#eaf3fe] px-3.5 py-2 text-sm font-bold text-[#3268d8] sm:text-[15px]">
                혼자 연습하는 배우를 위한 AI 코치
              </p>
              <h1 className="mt-5 text-[34px] font-extrabold leading-[1.25] tracking-[-0.04em] sm:text-5xl lg:text-[60px] lg:leading-[1.22]">
                내 연기를 같이 봐 줄<br className="hidden sm:block" /> 사람이 없을 때,{" "}
                <span className="text-[#4880ee]">액터브</span>
              </h1>
              <p className="mt-5 text-base leading-[1.6] text-[#4e5968] sm:text-xl">
                연기 영상을 올리면 코치가 장면을 보고 질문해요.
                <br className="hidden sm:block" /> 대본을 넣으면 상대역 대사를 소리 내 읽어 줘요.
              </p>

              <a
                href={appHref}
                data-app-download="landing_hero"
                className={`mt-7 flex h-14 w-full items-center justify-center rounded-[14px] bg-[#4880ee] text-[17px] font-bold text-white lg:hidden ${FOCUS}`}
              >
                앱 열기 · 무료로 설치
              </a>

              <div className="mt-9 hidden w-fit items-center gap-5 rounded-[22px] border border-[#edf0f3] bg-white p-[18px] pr-6 shadow-[0_6px_24px_rgba(72,128,238,0.08)] lg:flex">
                <Qr size={112} />
                <div>
                  <p className="text-[17px] font-extrabold">휴대폰 카메라로 찍으면 설치 화면으로 가요</p>
                  <p className="mt-1 text-sm text-[#6b7684]">iPhone · Android 무료</p>
                  <StoreBadges surface="landing_hero" className="mt-3" />
                </div>
              </div>

              <p className="mt-4 text-center text-[15px] font-semibold text-[#4e5968] lg:mt-5 lg:text-left lg:text-base">
                {returningGuest ? "이 브라우저에서 하던 연습이 있어요 " : "설치 전에 "}
                <Link
                  href={returningGuest ? homeHref : practiceHref}
                  className={`rounded font-bold text-[#3268d8] hover:underline ${FOCUS}`}
                >
                  {returningGuest ? "이어서 연습하기 →" : "웹에서 먼저 해 보기 →"}
                </Link>
              </p>
            </div>
            <div className="relative h-[330px] w-[260px] shrink-0 overflow-hidden sm:h-[420px] lg:h-[560px] lg:w-[440px] lg:overflow-visible">
              <Phone src="/site/shot-coach.jpg" alt="앱의 코칭 질문 대화 화면" className="absolute left-0 top-0 z-10 w-[260px] lg:w-[300px]" />
              <Phone
                src="/site/shot-reading.jpg"
                alt="앱의 대본 리딩 화면"
                className="absolute left-[200px] top-[70px] hidden w-[240px] rotate-[4deg] lg:block"
              />
            </div>
          </div>
        </section>

        <div className="border-b border-[#edf0f3]">
          <ul className="mx-auto flex max-w-[1200px] flex-col items-center gap-2 px-5 py-6 text-[15px] font-semibold text-[#4e5968] sm:flex-row sm:justify-center sm:gap-14">
            <li>코치가 <b className="text-[#191f28]">질문하며</b> 장면을 같이 봐요</li>
            <li>상대역이 없어도 <b className="text-[#191f28]">대사가 오가요</b></li>
            <li>매주 <b className="text-[#191f28]">공식 대사 챌린지</b></li>
          </ul>
        </div>

        {features.map((f, i) => (
          <section
            key={f.id}
            id={f.id}
            aria-labelledby={`${f.id}-title`}
            className={`scroll-mt-20 ${i % 2 === 1 ? "bg-[#f9fafb]" : ""}`}
          >
            <div
              className={`mx-auto flex max-w-[1200px] flex-col items-center gap-10 px-5 py-16 sm:px-8 lg:gap-[90px] lg:py-24 ${i % 2 === 1 ? "lg:flex-row-reverse" : "lg:flex-row"}`}
            >
              <div className="w-full flex-1">
                <p className="text-sm font-extrabold text-[#4880ee] sm:text-base">{f.kicker}</p>
                <h2 id={`${f.id}-title`} className="mt-3 text-[26px] font-extrabold leading-[1.3] tracking-[-0.035em] sm:text-[42px]">
                  {f.title[0]}
                  <br />
                  {f.title[1]}
                </h2>
                <p className="mt-4 text-base leading-[1.7] text-[#4e5968] sm:text-lg">{f.body}</p>
                <ul className="mt-5 space-y-2">
                  {f.bullets.map((b) => (
                    <li key={b} className="flex gap-2.5 text-[15px] text-[#333d4b] sm:text-base">
                      <span aria-hidden="true" className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#4880ee]" />
                      {b}
                    </li>
                  ))}
                </ul>
                <div className="mt-7 flex flex-wrap gap-2.5">
                  <a
                    href={appSectionHref}
                    data-app-download="landing_app_section"
                    className={`inline-flex h-12 items-center rounded-[14px] bg-[#4880ee] px-[18px] text-[15px] font-bold text-white transition hover:bg-[#3268d8] ${FOCUS}`}
                  >
                    {f.appLabel}
                  </a>
                  {f.web ? (
                    <Link
                      href={f.web.href}
                      className={`inline-flex h-12 items-center rounded-[14px] bg-[#f2f4f6] px-[18px] text-[15px] font-bold text-[#333d4b] transition hover:bg-[#e5e8eb] ${FOCUS}`}
                    >
                      {f.web.label}
                    </Link>
                  ) : null}
                </div>
              </div>
              <Phone src={f.shot} alt={f.shotAlt} className="w-[240px] shrink-0 lg:w-[280px]" />
            </div>
          </section>
        ))}

        <section aria-labelledby="price-title" className="bg-[#f9fafb]">
          <div className="mx-auto max-w-[1200px] px-5 py-16 sm:px-8 lg:py-24">
            <h2 id="price-title" className="text-[26px] font-extrabold tracking-[-0.035em] sm:text-[38px]">
              무료로 시작하고, 더 하고 싶을 때 Pro
            </h2>
            <p className="mt-3 text-base text-[#4e5968] sm:text-[17px]">무료와 Pro는 같은 코치를 써요. 차이는 횟수와 보관 개수예요.</p>
            <p className="mt-2 text-sm text-[#8a4b00]">{PAYMENT_START_NOTICE}</p>
            <div className="mt-8 grid gap-4 md:grid-cols-2 md:gap-5">
              <div className="rounded-3xl border border-[#e5e8eb] bg-white p-6 sm:p-[30px]">
                <h3 className="text-lg font-extrabold">무료</h3>
                <p className="mt-2 text-[34px] font-extrabold tracking-[-0.03em]">0원</p>
                <p className="text-[13.5px] text-[#6b7684]">출시 후 무료 이용 범위 · 지금은 한도를 적용하지 않아요</p>
                <ul className="mt-5 divide-y divide-[#edf0f3] border-t border-[#edf0f3] text-[15.5px] text-[#333d4b]">
                  <li className="py-2.5">코칭 하루 1회</li>
                  <li className="py-2.5">리딩 대본 1개 보관</li>
                  <li className="py-2.5">챌린지 참여·시청·댓글</li>
                </ul>
              </div>
              <div className="rounded-3xl border-2 border-[#4880ee] bg-[#f5f9ff] p-6 sm:p-[30px]">
                <h3 className="text-lg font-extrabold">Pro</h3>
                <p className="mt-2 text-[34px] font-extrabold tracking-[-0.03em]">
                  월 3,900원 <span className="text-base font-semibold text-[#6b7684]">부가세 포함</span>
                </p>
                <p className="text-[13.5px] text-[#6b7684]">결제일부터 1개월 · 매월 정기결제</p>
                <ul className="mt-5 divide-y divide-[#edf0f3] border-t border-[#edf0f3] text-[15.5px] text-[#333d4b]">
                  <li className="py-2.5">코칭 횟수 제한 없음</li>
                  <li className="py-2.5">리딩 대본 개수 제한 없음</li>
                  <li className="py-2.5">발음·딕션 피드백 (준비 중)</li>
                </ul>
              </div>
            </div>
            <Link href="/pricing" className={`mt-5 inline-block rounded text-[15px] font-bold text-[#3268d8] hover:underline ${FOCUS}`}>
              요금·해지·환불 자세히 보기 →
            </Link>
          </div>
        </section>

        <section aria-labelledby="faq-title" className="mx-auto max-w-[1200px] px-5 py-16 sm:px-8 lg:py-24">
          <div className="flex flex-col gap-8 lg:flex-row lg:gap-20">
            <div className="lg:w-[340px]">
              <h2 id="faq-title" className="text-[26px] font-extrabold tracking-[-0.035em] sm:text-[38px]">자주 묻는 질문</h2>
              <div className="mt-6 rounded-[18px] bg-[#f9fafb] p-[22px]">
                <p className="text-base font-extrabold">답을 못 찾았나요?</p>
                <p className="mt-1.5 text-sm leading-6 text-[#6b7684]">로그인하지 않아도 문의를 남길 수 있어요.</p>
                <Link
                  href="/help"
                  className={`mt-3.5 inline-flex h-11 items-center rounded-xl bg-[#4880ee] px-4 text-[15px] font-bold text-white ${FOCUS}`}
                >
                  고객센터 가기
                </Link>
              </div>
            </div>
            <div className="flex-1">
              {faq.map((item) => (
                <details key={item.q} className="group border-b border-[#e5e8eb]">
                  <summary className={`flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-base font-bold sm:text-lg ${FOCUS}`}>
                    {item.q}
                    <span aria-hidden="true" className="text-[22px] font-normal text-[#8b95a1] transition group-open:rotate-45">+</span>
                  </summary>
                  <p className="pb-5 text-[15.5px] leading-[1.65] text-[#4e5968]">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="band-title" className="px-5 pb-16 sm:px-8 lg:pb-24">
          <div className="mx-auto flex max-w-[1200px] flex-col gap-6 rounded-[32px] bg-[#1e2430] px-7 py-10 text-white lg:flex-row lg:items-center lg:gap-10 lg:px-16 lg:py-[52px]">
            <div className="flex-1">
              <h2 id="band-title" className="text-[26px] font-extrabold leading-[1.3] tracking-[-0.03em] sm:text-4xl">
                오늘 찍은 연기,
                <br />
                코치와 같이 봐요
              </h2>
              <p className="mt-2.5 text-base text-[#b9c1cc] sm:text-[17px]">
                앱은 무료예요.<span className="hidden lg:inline"> 휴대폰 카메라로 QR을 찍어 주세요.</span>
              </p>
            </div>
            <div className="hidden lg:block">
              <Qr size={128} />
            </div>
            <StoreBadges surface="landing_cta" className="lg:flex-col" />
          </div>
        </section>
      </main>
      <SiteFooter showBadges={false} />
      <StickyDownloadBar heroId="hero" />
    </div>
  );
}
