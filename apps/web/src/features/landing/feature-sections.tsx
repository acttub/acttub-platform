"use client";

import Link from "next/link";

import { useAppDownloadHref } from "@/features/app-download/app-download-button";

import { FOCUS, FOCUS_ON_DARK, Phone } from "./shared";

function AppCta({ label, dark = false }: { label: string; dark?: boolean }) {
  const href = useAppDownloadHref("landing_app_section");
  return (
    <a
      href={href}
      data-app-download="landing_app_section"
      className={`inline-flex h-14 items-center rounded-full px-7 text-base font-extrabold transition ${
        dark
          ? `bg-[#ffa21f] text-[#151a30] hover:bg-[#ffb347] ${FOCUS_ON_DARK}`
          : `bg-[#151a30] text-white hover:bg-[#2a3150] ${FOCUS}`
      }`}
    >
      {label}
    </a>
  );
}

function WebCta({ href, dark = false }: { href: string; dark?: boolean }) {
  return (
    <Link
      href={href}
      className={`inline-flex h-14 items-center rounded-full border-2 px-7 text-base font-extrabold transition ${
        dark ? `border-white/60 text-white hover:bg-white/10 ${FOCUS_ON_DARK}` : `border-[#151a30] text-[#151a30] hover:bg-[#151a30]/5 ${FOCUS}`
      }`}
    >
      웹에서 해 보기
    </Link>
  );
}

/** 코칭: 번호가 붙은 세 걸음. 크림 바탕, 휴대폰 둘이 겹쳐 선다. */
export function CoachingSection({ webHref }: { webHref: string }) {
  const steps = [
    ["영상 올리기", "찍어 둔 연기 영상을 올려요. 영상 없이 말로 고민을 털어놔도 돼요."],
    ["질문에 답하기", "코치가 장면을 보고 묻고, 나는 짧게 답해요. 단정하지 않고 같이 봐요."],
    ["다음 테이크 정하기", "대화가 끝나면 다음 테이크에서 해 볼 것 하나와 연습 노트가 남아요."],
  ];
  return (
    <section id="coaching" aria-labelledby="coaching-title" className="scroll-mt-20 bg-[#fff6e6] text-[#151a30]">
      <div data-reveal className="mx-auto flex max-w-[1200px] flex-col gap-12 px-5 py-20 sm:px-8 lg:flex-row lg:items-center lg:gap-20 lg:py-28">
        <div className="relative mx-auto h-[420px] w-[300px] shrink-0 sm:h-[520px] sm:w-[380px] lg:mx-0 lg:h-[600px] lg:w-[420px]">
          <Phone src="/site/shot-note.jpg" alt="앱의 연습 노트 화면" className="absolute right-0 top-[60px] w-[56%] rotate-[5deg]" />
          <Phone src="/site/shot-coach.jpg" alt="앱의 코칭 질문 대화 화면" className="absolute left-0 top-0 z-10 w-[62%] -rotate-[3deg]" />
        </div>
        <div className="flex-1">
          <p className="text-base font-extrabold">01 · 연기 코칭</p>
          <h2 id="coaching-title" className="mt-3 text-[clamp(36px,6vw,68px)] font-black leading-[1.08] tracking-[-0.055em]">
            답하다 보면
            <br />
            막힌 곳이 보여요
          </h2>
          <ol className="mt-9 space-y-6">
            {steps.map(([t, d], i) => (
              <li key={t} className="flex gap-5">
                <span aria-hidden="true" className="w-12 shrink-0 text-[44px] font-black leading-none tracking-[-0.05em] text-[#c76a00]">
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-xl font-extrabold">{t}</h3>
                  <p className="mt-1 text-base leading-[1.6] text-[#3d4256]">{d}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-10 flex flex-wrap gap-3">
            <AppCta label="앱에서 코칭 받기" />
            <WebCta href={webHref} />
          </div>
        </div>
      </div>
    </section>
  );
}

/** 리딩: 주황 전면. 두 사람의 대사 줄을 큰 글자로 보여 주고 휴대폰을 기울인다. */
export function ReadingSection({ webHref }: { webHref: string }) {
  return (
    <section id="reading" aria-labelledby="reading-title" className="scroll-mt-20 overflow-hidden bg-[#ffa21f] text-[#151a30]">
      <div data-reveal className="mx-auto flex max-w-[1200px] flex-col gap-12 px-5 py-20 sm:px-8 lg:flex-row-reverse lg:items-center lg:gap-16 lg:py-28">
        <div className="mx-auto w-[260px] shrink-0 rotate-[4deg] sm:w-[300px] lg:mx-0 lg:w-[340px]">
          <Phone src="/site/shot-reading.jpg" alt="앱의 대본 리딩 화면" />
        </div>
        <div className="flex-1">
          <p className="text-base font-extrabold">02 · 대본 리딩</p>
          <h2 id="reading-title" className="mt-3 text-[clamp(36px,6vw,68px)] font-black leading-[1.08] tracking-[-0.055em]">
            혼자여도,
            <br />
            대사는 오가요
          </h2>
          <div className="mt-8 space-y-3 text-[clamp(20px,2.6vw,28px)] font-extrabold leading-[1.3] tracking-[-0.03em]">
            <p className="w-fit rounded-[22px] rounded-bl-md bg-[#151a30] px-5 py-3 text-white">상대역 대사는 AI 음성이 읽어 줘요</p>
            <p className="ml-auto w-fit rounded-[22px] rounded-br-md bg-[#fff6e6] px-5 py-3 sm:ml-12">내 대사는 가리고 말해요</p>
          </div>
          <ul className="mt-8 space-y-2 text-base font-semibold leading-[1.6]">
            <li>TXT·DOCX·PDF·HWP 파일이나 붙여넣기로 대본을 넣어요</li>
            <li>예시 대본으로 바로 시작할 수도 있어요</li>
          </ul>
          <div className="mt-10 flex flex-wrap gap-3">
            <AppCta label="앱에서 리딩하기" />
            <WebCta href={webHref} />
          </div>
        </div>
      </div>
    </section>
  );
}

/** 챌린지: 남색 바탕에 가운데 휴대폰, 양옆으로 글. 위의 두 구간과 짜임이 다르다. */
export function ChallengeSection() {
  return (
    <section id="challenge" aria-labelledby="challenge-title" className="scroll-mt-20 bg-[#151a30] text-white">
      <div data-reveal className="mx-auto max-w-[1200px] px-5 py-20 text-center sm:px-8 lg:py-28">
        <p className="text-base font-extrabold text-[#ffd9a0]">03 · 주간 공식 대사 챌린지</p>
        <h2 id="challenge-title" className="mt-3 text-[clamp(38px,8vw,104px)] font-black leading-[1.04] tracking-[-0.06em]">
          같은 대사,
          <br />
          <span className="text-[#ffa21f]">다른 연기</span>
        </h2>
        <p className="mx-auto mt-6 max-w-[560px] text-lg leading-[1.6] text-[#d5d9e6]">
          매주 공식 대사가 열려요. 같은 대사를 다른 배우들이 어떻게 연기했는지 보고, 나도 찍어서 올려요.
        </p>
        <div className="mt-14 grid items-center gap-10 lg:grid-cols-[1fr_320px_1fr] lg:gap-14">
          <p className="text-2xl font-extrabold leading-[1.4] tracking-[-0.03em] lg:text-right lg:text-[32px]">
            이번 주 대사를
            <br />
            받아 와요
          </p>
          <Phone src="/site/shot-challenge.jpg" alt="앱의 챌린지 화면" className="mx-auto w-[260px] lg:w-[320px]" />
          <p className="text-2xl font-extrabold leading-[1.4] tracking-[-0.03em] lg:text-left lg:text-[32px]">
            다른 배우의 연기를
            <br />
            보고 나도 올려요
          </p>
        </div>
        <p className="mt-8 text-[15px] text-[#b9c1cc]">참여·좋아요·댓글은 앱에서 해요</p>
        <div className="mt-6 flex justify-center">
          <AppCta label="앱에서 참여하기" dark />
        </div>
      </div>
    </section>
  );
}
