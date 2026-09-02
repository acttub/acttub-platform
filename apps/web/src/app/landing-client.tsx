"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import wordmark from "../assets/acttub-wordmark.png";
import { AppDownloadButton } from "../features/app-download/app-download-button";
import { APP_HIGHLIGHTS } from "../features/app-download/app-highlights";
import { StickyDownloadBar } from "../features/app-download/sticky-download-bar";
import { StoreBadges } from "../features/app-download/store-badges";
import { isLoggedIn } from "../lib/auth/token-store";

const COPY = {
  wordmarkAlt: "Acttub",
  homeLabel: "Acttub 홈",
  nav: {
    flow: "서비스 흐름",
    result: "결과물",
    terms: "안전 약속",
    app: "앱 다운로드",
  },
  hero: {
    launch: "앱 출시",
    free: "iOS · Android 무료",
    titleFirst: "연기 영상 올리면",
    titleSecond: "앱이 질문해요",
    subFirst: "연습실에서 찍은 그 자리에서 바로.",
    subSecond: "말로 답하면 다음 테이크 문장이 남아요.",
    helper: "기기에 맞는 스토어로 바로 이동해요",
    web: "앱 없이 웹으로 계속하기 →",
    desktop: "무료로 사용해보기",
  },
  phone: {
    scene: "이별 통보 직후, 카페에서",
    time: "관찰 시점 00:12",
    counter: "질문 04 / 07",
    observation: "말을 끝낸 뒤 시선이 아래로 내려가는 순간이 보여요.",
    question: "그때 인물은 무엇을 기다리고 있었나요?",
    duration: "0:07",
    answer: "확신이 아니라… 상대가 한 번만 더 확인해 주길 바랐어요.",
    typing: "다음 질문 준비 중",
    sentenceLabel: "오늘의 문장",
    sentence: "“확신보다 확인을 원했다.”",
    sentenceFooter: "다음 연습 · 대답 전 2초 더 듣기",
    promise: "관찰 먼저, 단정은 안 해요",
  },
  app: {
    eyebrow: "앱에서만",
    titleFirst: "연습실을 나오기 전에",
    titleSecond: "폰에서 바로",
    description:
      "영상은 어차피 폰으로 찍으니까요. 올리는 것부터 질문에 답하는 것까지 앱에서 한 번에 끝나요.",
  },
  flow: {
    eyebrow: "서비스 흐름",
    titleFirst: "처음 와도 바로 이해되는",
    titleSecond: "3단계 연기 복기",
  },
  result: {
    eyebrow: "결과물",
    titleFirst: "질문을 넘기면",
    titleSecond: "연습 노트가 남아요",
    description:
      "Acttub은 장면을 단정하지 않아요. 확인한 관찰만 질문의 근거로 삼고, 마지막 문장은 배우가 직접 선택하게 합니다.",
    terms: "안전한 질문 원칙 보기 →",
  },
  bottom: {
    label: "Ready to practice",
    titleFirst: "오늘 찍은 장면으로",
    titleSecond: "바로 질문을 받아보세요",
    web: "앱 없이 웹으로 계속하기 →",
  },
  footer: {
    description:
      "질문으로 다시 보는 연기 연습. 웹에서도, 앱에서도 같은 계정으로 이어서 해요.",
    instagram: "인스타그램",
    email: "acttub0527@gmail.com",
  },
  productFlow: [
    {
      label: "1 · 입력",
      title: "연기 영상 업로드",
      description: "MP4/MOV 영상과 장면의 상황, 인물, 숨은 의도를 적어요.",
    },
    {
      label: "2 · 질문",
      title: "확인된 단서로 질문",
      description:
        "보이는 관찰을 먼저 확인하고, 단정하지 않는 질문으로 이어가요.",
    },
    {
      label: "3 · 결과",
      title: "내 연습 노트 완성",
      description: "답변을 모아 다음 테이크에서 붙잡을 한 문장으로 정리해요.",
    },
  ],
  outcomes: [
    ["놓친 순간", "영상 속 작은 멈춤과 반응을 다시 보게 해요."],
    ["장면 의도", "인물의 목표와 상대에게 기대한 것을 말로 붙잡아요."],
    ["다음 액션", "다음 테이크에서 바로 시도할 연습 문장을 남겨요."],
  ],
} as const;

const waveformHeights = [8, 15, 25, 18, 10, 23, 28, 13, 20, 9, 16, 24, 11];
const practiceLoginHref = "/login?next=/practice/new";

export default function LandingClient() {
  const router = useRouter();
  useEffect(() => {
    if (isLoggedIn()) router.replace("/home");
  }, [router]);

  useEffect(() => {
    const screens = document.querySelectorAll<HTMLElement>("[data-reveal]");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          (entry.target as HTMLElement).dataset.visible = "true";
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.22 },
    );

    screens.forEach((screen) => observer.observe(screen));
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <main className="h-dvh snap-y snap-mandatory scroll-smooth overflow-y-auto overscroll-y-contain bg-white text-[#191f28] [@media(max-height:700px)]:snap-proximity">
        <header className="sticky top-0 z-20 -mb-16 border-b border-[#edf0f3]/80 bg-white/90 px-5 backdrop-blur-xl">
          <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between">
            <Link href="/" aria-label={COPY.homeLabel} className="shrink-0">
              <Image
                src={wordmark}
                alt={COPY.wordmarkAlt}
                priority
                className="h-6 w-auto"
              />
            </Link>
            <div className="flex items-center gap-8">
              <div className="hidden items-center gap-8 text-sm font-semibold text-[#4e5968] sm:flex">
                <a href="#flow" className="transition hover:text-[#191f28]">
                  {COPY.nav.flow}
                </a>
                <a href="#result" className="transition hover:text-[#191f28]">
                  {COPY.nav.result}
                </a>
                <Link href="/terms" className="transition hover:text-[#191f28]">
                  {COPY.nav.terms}
                </Link>
              </div>
              {/* 앱은 폰에서 받는다 — 이 버튼만은 좁은 화면에서도 접지 않는다. */}
              <Link
                href="/app"
                className="inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-[#3182f6] px-4 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-[#1b64da]"
              >
                {COPY.nav.app}
              </Link>
            </div>
          </nav>
        </header>

        <section
          id="hero"
          className="relative flex min-h-dvh snap-start scroll-mt-0 flex-col justify-center overflow-hidden break-keep bg-[linear-gradient(180deg,#eaf6ff_0%,#f8fbff_58%,#ffffff_100%)] px-5 pt-16"
        >
          <div className="absolute left-1/2 top-12 h-80 w-80 -translate-x-1/2 rounded-full bg-[#3182f6]/[0.16] blur-3xl" />
          <div className="absolute -left-24 top-1/2 h-64 w-64 rounded-full bg-white/70 blur-3xl" />
          <div
            data-reveal
            className="relative mx-auto grid w-full max-w-6xl translate-y-6 items-center gap-4 py-4 opacity-0 transition-[opacity,transform] duration-400 ease-[cubic-bezier(0,0,0.2,1)] data-[visible=true]:translate-y-0 data-[visible=true]:opacity-100 motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:transition-none sm:gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.7fr)] lg:gap-12"
          >
            <div className="text-center lg:text-left">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/85 px-3 py-2 shadow-[0_6px_24px_rgba(49,130,246,0.1)]">
                <span className="rounded-full bg-[#3182f6] px-2 py-0.5 text-[11px] font-black text-white">
                  {COPY.hero.launch}
                </span>
                <span className="text-sm font-black text-[#3182f6]">
                  {COPY.hero.free}
                </span>
              </div>
              <h1 className="mt-4 text-3xl font-black leading-[1.1] tracking-tight sm:mt-6 sm:text-6xl lg:text-7xl">
                {COPY.hero.titleFirst}
                <br />
                {COPY.hero.titleSecond}
              </h1>
              <p className="mt-3 text-base font-semibold leading-[1.6] text-[#4e5968] sm:mt-6 sm:text-xl">
                {COPY.hero.subFirst}
                <br className="sm:hidden" /> {COPY.hero.subSecond}
              </p>
              <div className="mx-auto mt-4 max-w-md sm:hidden">
                <AppDownloadButton
                  surface="landing_hero"
                  size="lg"
                  className="w-full"
                />
                <p className="mt-2 text-[12px] font-medium text-[#8b95a1]">
                  {COPY.hero.helper}
                </p>
                <Link
                  href={practiceLoginHref}
                  prefetch={false}
                  className="mt-2 inline-block text-sm font-bold text-[#4e5968] underline underline-offset-4"
                >
                  {COPY.hero.web}
                </Link>
              </div>
              <div className="mt-9 hidden items-center justify-center gap-3 sm:flex lg:justify-start">
                <Link
                  href={practiceLoginHref}
                  prefetch={false}
                  className="inline-flex h-14 items-center justify-center rounded-2xl bg-[#191f28] px-7 text-base font-black text-white shadow-[0_14px_34px_rgba(25,31,40,0.18)] transition hover:-translate-y-0.5 hover:bg-[#333d4b]"
                >
                  {COPY.hero.desktop}
                </Link>
                <AppDownloadButton surface="landing_hero" />
              </div>
            </div>
            <PhoneMockup />
          </div>
        </section>

        <section
          id="app"
          className="flex min-h-dvh snap-start scroll-mt-0 flex-col justify-center bg-[#f9fafb] px-5 pt-16"
        >
          <div
            data-reveal
            className="mx-auto grid w-full max-w-5xl translate-y-6 gap-6 py-4 opacity-0 transition-[opacity,transform] duration-400 ease-[cubic-bezier(0,0,0.2,1)] data-[visible=true]:translate-y-0 data-[visible=true]:opacity-100 motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:transition-none sm:gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center"
          >
            <div>
              <p className="text-lg font-black text-[#3182f6]">
                {COPY.app.eyebrow}
              </p>
              <h2 className="mt-2 text-3xl font-black leading-tight tracking-[-0.05em] sm:mt-4 sm:text-5xl">
                {COPY.app.titleFirst}
                <br />
                {COPY.app.titleSecond}
              </h2>
              <p className="mt-3 text-base font-semibold leading-7 text-[#4e5968] sm:mt-7 sm:text-lg sm:leading-8">
                {COPY.app.description}
              </p>
              <StoreBadges
                surface="landing_app_section"
                size="lg"
                className="mt-4 sm:mt-8"
              />
            </div>
            <div className="grid gap-3 sm:gap-4">
              {APP_HIGHLIGHTS.map((item, index) => (
                <article
                  key={item.title}
                  className="flex items-start gap-3 rounded-[20px] bg-white p-4 sm:gap-4 sm:rounded-[24px] sm:p-6"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-[#e8f3ff] text-[#3182f6]">
                    <HighlightIcon index={index} />
                  </span>
                  <div>
                    <h3 className="text-xl font-black tracking-[-0.03em]">
                      {item.title}
                    </h3>
                    <p className="mt-1 text-sm font-semibold leading-5 text-[#6b7684] sm:mt-2 sm:text-[15px] sm:leading-6">
                      {item.body}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          id="flow"
          className="flex min-h-dvh snap-start scroll-mt-0 flex-col justify-center bg-white px-5 pt-16"
        >
          <div
            data-reveal
            className="mx-auto w-full max-w-5xl translate-y-6 py-4 opacity-0 transition-[opacity,transform] duration-400 ease-[cubic-bezier(0,0,0.2,1)] data-[visible=true]:translate-y-0 data-[visible=true]:opacity-100 motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:transition-none"
          >
            <p className="text-lg font-black text-[#3182f6]">
              {COPY.flow.eyebrow}
            </p>
            <h2 className="mt-2 max-w-3xl text-3xl font-black leading-tight tracking-[-0.05em] sm:mt-4 sm:text-5xl">
              {COPY.flow.titleFirst}
              <br />
              {COPY.flow.titleSecond}
            </h2>
            <div className="mt-6 grid gap-3 sm:mt-10 md:grid-cols-3 md:gap-5">
              {COPY.productFlow.map((item) => (
                <article
                  key={item.label}
                  className="rounded-[24px] bg-[#f2f4f6] p-5 sm:rounded-[32px] sm:p-7"
                >
                  <p className="text-sm font-black text-[#3182f6]">
                    {item.label}
                  </p>
                  <h3 className="mt-3 text-xl font-black tracking-[-0.04em] sm:mt-8 sm:text-2xl">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm font-semibold leading-5 text-[#6b7684] sm:mt-4 sm:text-base sm:leading-7">
                    {item.description}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          id="result"
          className="flex min-h-dvh snap-start scroll-mt-0 flex-col justify-center bg-[#f9fafb] px-5 pt-16"
        >
          <div
            data-reveal
            className="mx-auto grid w-full max-w-5xl translate-y-6 gap-6 py-4 opacity-0 transition-[opacity,transform] duration-400 ease-[cubic-bezier(0,0,0.2,1)] data-[visible=true]:translate-y-0 data-[visible=true]:opacity-100 motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:transition-none sm:gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center"
          >
            <div>
              <p className="text-lg font-black text-[#3182f6]">
                {COPY.result.eyebrow}
              </p>
              <h2 className="mt-2 text-3xl font-black leading-tight tracking-[-0.05em] sm:mt-4 sm:text-5xl">
                {COPY.result.titleFirst}
                <br />
                {COPY.result.titleSecond}
              </h2>
              <p className="mt-3 text-base font-semibold leading-6 text-[#4e5968] sm:mt-7 sm:text-lg sm:leading-8">
                {COPY.result.description}
              </p>
              <Link
                href="/terms"
                className="mt-3 inline-block text-sm font-extrabold text-[#333d4b] underline underline-offset-4 sm:mt-8"
              >
                {COPY.result.terms}
              </Link>
            </div>
            <div className="grid gap-3 sm:gap-4">
              {COPY.outcomes.map(([title, description]) => (
                <article
                  key={title}
                  className="rounded-[24px] bg-white p-5 sm:rounded-[32px] sm:p-7"
                >
                  <h3 className="text-2xl font-black tracking-[-0.05em] text-[#191f28] sm:text-3xl">
                    {title}
                  </h3>
                  <p className="mt-2 text-sm font-bold leading-5 text-[#4e5968] sm:mt-3 sm:text-lg sm:leading-8">
                    {description}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="flex min-h-dvh snap-start scroll-mt-0 flex-col justify-center bg-[#191f28] px-5 pb-24 pt-16 text-white sm:pb-0">
          <div
            data-reveal
            className="mx-auto flex w-full max-w-5xl translate-y-6 flex-col opacity-0 transition-[opacity,transform] duration-400 ease-[cubic-bezier(0,0,0.2,1)] data-[visible=true]:translate-y-0 data-[visible=true]:opacity-100 motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:transition-none"
          >
            <div className="flex flex-col items-start justify-between gap-6 py-6 md:flex-row md:items-center">
              <div>
                <p className="text-base font-bold text-[#8b95a1]">
                  {COPY.bottom.label}
                </p>
                <h2 className="mt-2 text-3xl font-black leading-tight tracking-[-0.05em] sm:mt-4 sm:text-5xl">
                  {COPY.bottom.titleFirst}
                  <br />
                  {COPY.bottom.titleSecond}
                </h2>
              </div>
              <div className="flex w-full flex-col items-start md:w-auto md:items-end">
                <AppDownloadButton
                  surface="landing_cta"
                  size="lg"
                  className="w-full sm:w-auto"
                />
                <StoreBadges surface="landing_cta" className="mt-3 sm:mt-5" />
                <Link
                  href={practiceLoginHref}
                  prefetch={false}
                  className="mt-3 text-sm font-bold text-[#b0b8c1] underline underline-offset-4 sm:mt-5"
                >
                  {COPY.bottom.web}
                </Link>
              </div>
            </div>
            <footer className="mt-auto border-t border-white/10 py-6">
              <div className="mx-auto flex max-w-5xl flex-col gap-5 md:flex-row md:items-start md:justify-between">
                <div>
                  <Image
                    src={wordmark}
                    alt={COPY.wordmarkAlt}
                    className="h-6 w-auto brightness-0 invert"
                  />
                  <p className="mt-3 max-w-sm text-sm font-semibold leading-6 text-[#b0b8c1] sm:text-base sm:leading-7">
                    {COPY.footer.description}
                  </p>
                </div>
                <nav className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm font-bold text-[#b0b8c1] md:grid-cols-1">
                  <Link href="/app" className="transition hover:text-white">
                    {COPY.nav.app}
                  </Link>
                  <a href="#flow" className="transition hover:text-white">
                    {COPY.nav.flow}
                  </a>
                  <Link href="/terms" className="transition hover:text-white">
                    {COPY.nav.terms}
                  </Link>
                  <a
                    href="https://www.instagram.com/acttub_com/"
                    target="_blank"
                    rel="noreferrer"
                    className="transition hover:text-white"
                  >
                    {COPY.footer.instagram}
                  </a>
                  <a
                    href={`mailto:${COPY.footer.email}`}
                    className="transition hover:text-white"
                  >
                    {COPY.footer.email}
                  </a>
                </nav>
              </div>
            </footer>
          </div>
        </section>
      </main>

      <StickyDownloadBar heroId="hero" />
    </>
  );
}

function PhoneMockup() {
  // 데스크톱은 글이 주인공이라 폰을 줄인다 — 1.09 로 키웠을 때 화면 절반을 폰이 먹어
  // 제목이 밀렸다. 문장 카드가 폰 아래로 빠지는 만큼 아래 여백을 더 둔다.
  return (
    <div className="relative mx-auto mb-8 w-[330px] [zoom:.55] sm:mb-14 sm:[zoom:.85] lg:mb-24 lg:[zoom:.8]">
      {/* 높이는 안의 대화가 딱 차는 만큼만 — 더 길면 아래가 비고, 그 빈 곳을 문장 카드가
          덮으면서 "준비 중" 알약까지 가린다. */}
      <div className="relative mx-auto flex aspect-[330/600] flex-col gap-4 overflow-hidden rounded-[52px] border-[10px] border-[#191f28] bg-white p-5 pt-7 shadow-[0_30px_70px_rgba(25,31,40,0.22)]">
        <span className="mx-auto h-1.5 w-[72px] shrink-0 rounded-full bg-[#333d4b]" />
        <div className="flex items-center gap-3">
          <div className="relative h-[62px] w-[92px] shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-[#4e5968] to-[#dbeafe]">
            <PlayIcon />
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-black leading-5">
              {COPY.phone.scene}
            </p>
            <p className="mt-1 text-xs font-bold text-[#3182f6]">
              {COPY.phone.time}
            </p>
          </div>
        </div>
        <div className="relative h-[5px] rounded-full bg-[#f2f4f6]">
          <span className="absolute inset-y-0 left-0 w-[37%] rounded-full bg-[#3182f6]" />
          <span className="absolute left-[37%] top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#3182f6] shadow-sm" />
        </div>
        <span className="self-start rounded-full bg-[#e8f3ff] px-3 py-1 text-[13px] font-black text-[#3182f6]">
          {COPY.phone.counter}
        </span>
        <div className="rounded-[18px] rounded-bl-[6px] border border-[#edf0f3] bg-[#f9fafb] p-4">
          <p className="text-sm font-bold leading-5 text-[#6b7684]">
            {COPY.phone.observation}
          </p>
          <p className="mt-2 text-[19px] font-black leading-7 text-[#191f28]">
            {COPY.phone.question}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2.5 rounded-[18px] rounded-br-[6px] bg-[#191f28] px-4 py-3">
          <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-[#3182f6] text-white">
            <MicIcon />
          </span>
          <span className="flex h-7 items-center gap-1">
            {waveformHeights.map((height, index) => (
              <span
                key={`${height}-${index}`}
                className="w-1 rounded-full bg-[#8fbfff]"
                style={{ height }}
              />
            ))}
          </span>
          <span className="text-[13px] font-bold text-[#d1d6db]">
            {COPY.phone.duration}
          </span>
        </div>
        <div className="ml-auto max-w-[256px] rounded-[18px] rounded-tr-[6px] bg-[#3182f6] px-4 py-3 text-[15px] font-bold leading-relaxed text-white">
          {COPY.phone.answer}
        </div>
        <div className="flex self-start items-center gap-2 rounded-full bg-[#f2f4f6] px-3 py-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[#8b95a1]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#b0b8c1]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#d1d6db]" />
          <span className="text-[13px] font-bold text-[#6b7684]">
            {COPY.phone.typing}
          </span>
        </div>
      </div>
      {/* 위치는 %가 아니라 px — 폰 위쪽(노치·장면·타임라인)은 폭이 바뀌어도 높이가 고정이라
          px 로 두면 어느 폭에서도 "질문 04 / 07" 옆에 붙는다. %는 폭마다 다른 줄에 떨어진다. */}
      <div className="absolute right-[-12px] top-[158px] flex rotate-[3deg] items-center gap-1.5 rounded-full bg-white px-3 py-2 shadow-[0_12px_30px_rgba(25,31,40,0.12)]">
        <EyeIcon />
        <span className="text-xs font-black text-[#191f28]">
          {COPY.phone.promise}
        </span>
      </div>
      <div className="absolute -bottom-10 right-0 w-[232px] rotate-[-3deg] rounded-[20px] lg:-bottom-24 lg:right-[-24px] bg-white p-4 shadow-[0_20px_50px_rgba(49,130,246,0.25)]">
        <div className="flex items-center gap-1.5 text-[#3182f6]">
          <SparklesIcon />
          <span className="text-[11px] font-black">
            {COPY.phone.sentenceLabel}
          </span>
        </div>
        <p className="mt-2 text-xl font-black leading-tight text-[#191f28]">
          {COPY.phone.sentence}
        </p>
        <p className="mt-3 text-xs font-bold text-[#6b7684]">
          {COPY.phone.sentenceFooter}
        </p>
      </div>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 text-white"
      fill="currentColor"
    >
      <path d="M8 5.6v12.8L18.5 12 8 5.6Z" />
    </svg>
  );
}
function MicIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" />
    </svg>
  );
}
function EyeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4 text-[#3182f6]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}
function SparklesIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3ZM19 14l.7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7L19 14ZM5 13l.8 2.2L8 16l-2.2.8L5 19l-.8-2.2L2 16l2.2-.8L5 13Z" />
    </svg>
  );
}
function HighlightIcon({ index }: { index: number }) {
  if (index === 0)
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-6 w-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="5" width="14" height="14" rx="3" />
        <path d="m17 10 4-2v8l-4-2" />
      </svg>
    );
  if (index === 1)
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-6 w-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <rect x="9" y="3" width="6" height="12" rx="3" />
        <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
      </svg>
    );
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}
