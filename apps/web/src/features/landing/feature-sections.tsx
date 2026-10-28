"use client";

import Link from "next/link";

import { useAppDownloadHref } from "@/features/app-download/app-download-button";

import {
  Acty,
  FOCUS,
  FOCUS_ON_DARK,
  GHOST_BUTTON_DARK,
  GHOST_BUTTON_LIGHT,
  Grain,
  Phone,
  SERIF,
} from "./shared";

/** 구간 안의 앱 받기. 주황은 첫 화면에만 크게 쓰므로 여기서는 테두리 버튼이다. */
function AppCta({ label, onPaper = false }: { label: string; onPaper?: boolean }) {
  const href = useAppDownloadHref("landing_app_section");
  return (
    <a href={href} data-app-download="landing_app_section" className={onPaper ? GHOST_BUTTON_LIGHT : GHOST_BUTTON_DARK}>
      {label}
    </a>
  );
}

function WebCta({ href, onPaper = false }: { href: string; onPaper?: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-sm px-1 text-[16px] underline underline-offset-[5px] transition-colors ${
        onPaper
          ? `text-[#1c1814] decoration-[#1c1814]/35 hover:decoration-[#1c1814] ${FOCUS}`
          : `text-[#f2ebe0] decoration-[#f2ebe0]/35 hover:decoration-[#f2ebe0] ${FOCUS_ON_DARK}`
      }`}
    >
      웹에서 해 보기
    </Link>
  );
}

/** 코칭: 먹색 바탕. 대화 끝에 남는 연습 노트 화면 하나와, 가는 선으로 나눈 세 걸음. */
export function CoachingSection({ webHref }: { webHref: string }) {
  const steps = [
    ["영상 올리기", "찍어 둔 연기 영상을 올려요. 영상 없이 말로 고민을 털어놔도 돼요."],
    ["질문에 답하기", "코치가 장면을 보고 묻고, 나는 짧게 답해요. 단정하지 않고 같이 봐요."],
    ["다음 테이크 정하기", "대화가 끝나면 다음 테이크에서 해 볼 것 하나와 연습 노트가 남아요."],
  ];
  return (
    <section id="coaching" aria-labelledby="coaching-title" className="relative scroll-mt-20 bg-[#14110e] text-[#f2ebe0]">
      <Grain />
      <div data-reveal className="relative mx-auto grid max-w-[1200px] gap-14 border-t border-[#f2ebe0]/10 px-6 py-24 sm:px-8 lg:grid-cols-[440px_minmax(0,1fr)] lg:items-center lg:gap-20 lg:py-36">
        <div className="mx-auto w-[240px] sm:w-[270px] lg:w-[290px]">
          <Phone src="/site/shot-note.jpg" alt="앱의 연습 노트 화면" />
        </div>
        <div className="order-first lg:order-none">
          <h2 id="coaching-title" className={`${SERIF} text-[clamp(32px,4.2vw,54px)] leading-[1.22]`}>
            답하다 보면
            <br />
            막힌 곳이 보여요
          </h2>
          <p className="mt-5 max-w-[30em] text-[17px] leading-[1.7] text-[#b8ad9e]">
            연기 영상 코칭. 정답을 내려 주기보다, 장면을 같이 다시 보게 묻는 코치예요.
          </p>
          <ol className="mt-10 border-t border-[#f2ebe0]/12">
            {steps.map(([t, d], i) => (
              <li key={t} className="grid grid-cols-[44px_minmax(0,1fr)] gap-x-3 border-b border-[#f2ebe0]/12 py-5">
                <span aria-hidden="true" className={`${SERIF} pt-[1px] text-[17px] text-[#8c8172]`}>
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-[18px] font-semibold">{t}</h3>
                  <p className="mt-1.5 text-[16px] leading-[1.65] text-[#b8ad9e]">{d}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4">
            <AppCta label="앱에서 코칭 받기" />
            <WebCta href={webHref} />
          </div>
        </div>
      </div>
    </section>
  );
}

/** 리딩: 미색 종이. 대본처럼 인물 이름과 대사를 나눠 적고, 내 대사는 가려 둔다. */
export function ReadingSection({ webHref }: { webHref: string }) {
  return (
    <section id="reading" aria-labelledby="reading-title" className="scroll-mt-20 bg-[#f3ede3] text-[#1c1814]">
      <div data-reveal className="mx-auto grid max-w-[1200px] gap-14 px-6 py-24 sm:px-8 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-center lg:gap-24 lg:py-36">
        <div>
          <h2 id="reading-title" className={`${SERIF} text-[clamp(32px,4.2vw,54px)] leading-[1.22]`}>
            혼자여도,
            <br />
            대사는 오가요
          </h2>
          <p className="mt-5 max-w-[30em] text-[17px] leading-[1.7] text-[#5c5247]">
            대본 리딩. 대본을 넣으면 상대역 대사는 AI 음성이 읽어 주고, 내 차례에는 내 대사를 가리고 말해요.
          </p>

          <figure className="relative mt-10 max-w-[520px] border-y border-[#1c1814]/15 py-6">
            <figcaption className="sr-only">리딩 화면이 대사를 나누는 방식</figcaption>
            <dl className={`${SERIF} grid grid-cols-[88px_minmax(0,1fr)] gap-x-4 gap-y-5 text-[17px] font-medium leading-[1.6] sm:text-[19px]`}>
              <dt className="pt-[3px] font-sans text-[13px] font-medium tracking-normal text-[#6e6357]">상대역</dt>
              <dd>상대역 대사는 AI 음성이 읽어 줘요.</dd>
              <dt className="pt-[3px] font-sans text-[13px] font-medium tracking-normal text-[#6e6357]">나</dt>
              <dd>
                <span className="sr-only">내 대사는 가려져 있어요.</span>
                <span aria-hidden="true" className="flex flex-col gap-2 pt-2">
                  <span className="block h-[11px] w-[58%] rounded-[2px] bg-[#1c1814]/80" />
                  <span className="block h-[11px] w-[40%] rounded-[2px] bg-[#1c1814]/80" />
                </span>
              </dd>
            </dl>
            <Acty pose="whisper" width={84} className="absolute bottom-[14px] right-0 w-[64px] sm:w-[84px]" />
          </figure>

          <ul className="mt-8 space-y-2 text-[16px] leading-[1.65] text-[#5c5247]">
            <li>TXT·DOCX·PDF·HWP 파일이나 붙여넣기로 대본을 넣어요</li>
            <li>예시 대본으로 바로 시작할 수도 있어요</li>
          </ul>
          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4">
            <AppCta label="앱에서 리딩하기" onPaper />
            <WebCta href={webHref} onPaper />
          </div>
        </div>
        <div className="mx-auto w-[250px] sm:w-[280px] lg:w-[300px]">
          <Phone src="/site/shot-reading.jpg" alt="앱의 대본 리딩 화면" onPaper />
        </div>
      </div>
    </section>
  );
}

/** 챌린지: 다시 먹색. 가운데에 휴대폰 한 대를 세우고 양옆에 짧은 설명을 둔다. 액티는 슬레이트를 든다. */
export function ChallengeSection() {
  return (
    <section id="challenge" aria-labelledby="challenge-title" className="relative scroll-mt-20 overflow-hidden bg-[#14110e] text-[#f2ebe0]">
      <Grain />
      <div data-reveal className="relative mx-auto max-w-[1200px] px-6 py-24 sm:px-8 lg:py-36">
        <div className="mx-auto max-w-[620px] text-center">
          <h2 id="challenge-title" className={`${SERIF} text-[clamp(32px,4.6vw,60px)] leading-[1.2]`}>
            같은 대사, 다른 연기
          </h2>
          <p className="mt-5 text-[17px] leading-[1.7] text-[#b8ad9e]">
            주간 공식 대사 챌린지. 매주 공식 대사가 열리면, 다른 배우들이 같은 대사를 어떻게 했는지 보고 나도 찍어 올려요.
          </p>
        </div>
        <div className="mt-16 grid items-center gap-10 lg:grid-cols-[1fr_300px_1fr] lg:gap-16">
          <div className="text-center lg:text-right">
            <p className={`${SERIF} text-[22px] leading-[1.45] lg:text-[26px]`}>이번 주 대사를 받아요</p>
            <p className="mt-2 text-[15px] text-[#8c8172]">매주 새 대사가 열려요</p>
          </div>
          <div className="relative mx-auto w-[250px] lg:w-[300px]">
            <Phone src="/site/shot-challenge.jpg" alt="앱의 챌린지 화면" />
            <Acty pose="slate" width={104} className="absolute bottom-0 left-[calc(100%+28px)] hidden w-[104px] sm:block" />
          </div>
          <div className="text-center lg:text-left">
            <p className={`${SERIF} text-[22px] leading-[1.45] lg:text-[26px]`}>다른 배우의 연기를 보고 나도 올려요</p>
            <p className="mt-2 text-[15px] text-[#8c8172]">참여·좋아요·댓글은 앱에서 해요</p>
          </div>
        </div>
        <div className="mt-14 flex justify-center">
          <AppCta label="앱에서 참여하기" />
        </div>
      </div>
    </section>
  );
}
