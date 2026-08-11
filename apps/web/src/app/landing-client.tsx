"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import wordmark from "../assets/acttub-wordmark.png";
import { isLoggedIn } from "../lib/auth/token-store";

const practiceLoginHref = "/login?next=/practice/new";

const demoSteps = [
  { number: "01", name: "영상 넣기" },
  { number: "02", name: "막힌 지점 적기" },
  { number: "03", name: "질문으로 풀기" },
  { number: "04", name: "연습 노트 받기" },
] as const;

const blockageChoices = [
  "마지막 대사가 갑자기 튀는 것 같아요",
  "감정이 한 가지로만 보여요",
  "상대의 말을 듣는 느낌이 안 나요",
  "왜 이 행동을 하는지 납득되지 않아요",
  "직접 적기",
] as const;

const firstAnswerChoices = [
  "상대가 붙잡아 주길 기대했어요",
  "내 마음을 알아주길 바랐어요",
  "아무 반응도 기대하지 않았어요",
] as const;

const secondAnswerChoices = [
  "시선을 피하지 않고 한 박자 기다려요",
  "상대의 반응을 먼저 보고 말해요",
  "말을 밀어내지 않고 작게 건네요",
] as const;

const discoveries: Record<string, string> = {
  "마지막 대사가 갑자기 튀는 것 같아요":
    "마지막 대사는 갑자기 나온 것이 아니라, 상대가 붙잡아 주길 기다리는 멈춤에서 이어지고 있었어요.",
  "감정이 한 가지로만 보여요":
    "떠나려는 마음과 붙잡히고 싶은 마음이 마지막 대사 직전에 함께 머물러 있었어요.",
  "상대의 말을 듣는 느낌이 안 나요":
    "상대의 반응을 기다리는 짧은 멈춤을 더 오래 바라보면 장면의 관계가 선명해져요.",
  "왜 이 행동을 하는지 납득되지 않아요":
    "이 행동은 상대가 나를 한 번 더 붙잡아 주기를 바라는 기대에서 시작됐어요.",
};

const defaultDiscovery =
  "시선이 머무는 순간과 마지막 대사 사이에 상대의 반응을 기다리는 마음이 있었어요.";

const learningReferences = [
  {
    title: "영상의 구체적인 순간에서 시작",
    source:
      "자극 회상(stimulated recall) 기법 · Schön, 『The Reflective Practitioner』(1983)",
  },
  {
    title: "정답보다 자기 설명을 돕는 질문",
    source: "Chi 외, 자기설명 효과 · Cognitive Science (1989·1994)",
  },
  {
    title: "다음 시도의 행동으로 연결",
    source:
      "Ericsson 외, 의도적 연습 · Psychological Review (1993) · Locke & Latham 목표 설정 이론",
  },
] as const;

const principles = [
  { mark: "×", text: "연기를 심사하지 않아요.", positive: false },
  {
    mark: "×",
    text: "장면의 해석을 먼저 단정하지 않아요.",
    positive: false,
  },
  {
    mark: "✓",
    text: "영상에서 확인된 순간부터 질문해요.",
    positive: true,
  },
  {
    mark: "✓",
    text: "마지막 선택은 배우가 직접 만들어요.",
    positive: true,
  },
] as const;

type DemoStep = 0 | 1 | 2 | 3;

export default function LandingClient() {
  const router = useRouter();
  const desktopTrackRef = useRef<HTMLDivElement>(null);
  const [desktopScrollStep, setDesktopScrollStep] = useState<DemoStep>(0);
  const [journeyStep, setJourneyStep] = useState<DemoStep>(0);
  const [sampleReady, setSampleReady] = useState(false);
  const [blockageDraft, setBlockageDraft] = useState("");
  const [chosenBlockage, setChosenBlockage] = useState<string | null>(null);
  const [directEntry, setDirectEntry] = useState(false);
  const [firstAnswer, setFirstAnswer] = useState<string | null>(null);
  const [secondAnswer, setSecondAnswer] = useState<string | null>(null);

  useEffect(() => {
    if (isLoggedIn()) router.replace("/home");
  }, [router]);

  useEffect(() => {
    let frameId = 0;

    const updateScrollStep = () => {
      frameId = 0;
      const track = desktopTrackRef.current;
      if (!track || !window.matchMedia("(min-width: 768px)").matches) return;

      const bounds = track.getBoundingClientRect();
      const scrollDistance = Math.max(track.offsetHeight - 600, 1);
      const progress = Math.min(Math.max((80 - bounds.top) / scrollDistance, 0), 1);
      const nextStep: DemoStep =
        progress < 0.25 ? 0 : progress < 0.5 ? 1 : progress < 0.75 ? 2 : 3;

      setDesktopScrollStep((currentStep) =>
        currentStep === nextStep ? currentStep : nextStep,
      );
    };

    const requestUpdate = () => {
      if (frameId) return;
      frameId = window.requestAnimationFrame(updateScrollStep);
    };

    updateScrollStep();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);

    return () => {
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      if (frameId) window.cancelAnimationFrame(frameId);
    };
  }, []);

  const desktopStep = Math.max(desktopScrollStep, journeyStep) as DemoStep;
  const noteDiscovery = chosenBlockage
    ? (discoveries[chosenBlockage] ?? defaultDiscovery)
    : defaultDiscovery;

  const useSample = () => {
    setSampleReady(true);
    setJourneyStep((current) => Math.max(current, 1) as DemoStep);
  };

  const selectBlockage = (choice: (typeof blockageChoices)[number]) => {
    const isDirect = choice === "직접 적기";
    setDirectEntry(isDirect);
    setBlockageDraft(isDirect ? "" : choice);
    setChosenBlockage(isDirect ? null : choice);
    setFirstAnswer(null);
    setSecondAnswer(null);
    setJourneyStep(1);
  };

  const writeBlockage = (value: string) => {
    setBlockageDraft(value);
    setChosenBlockage(value.trim() || null);
    setFirstAnswer(null);
    setSecondAnswer(null);
    setJourneyStep(1);
  };

  const startQuestions = () => {
    if (!chosenBlockage) return;
    setJourneyStep(2);
  };

  const chooseFirstAnswer = (answer: string) => {
    setFirstAnswer(answer);
    setSecondAnswer(null);
    setJourneyStep(2);
  };

  const chooseSecondAnswer = (answer: string) => {
    setSecondAnswer(answer);
    setJourneyStep(3);
  };

  const flowProps = {
    sampleReady,
    blockageDraft,
    chosenBlockage,
    directEntry,
    firstAnswer,
    secondAnswer,
    noteDiscovery,
    onUseSample: useSample,
    onSelectBlockage: selectBlockage,
    onWriteBlockage: writeBlockage,
    onStartQuestions: startQuestions,
    onChooseFirstAnswer: chooseFirstAnswer,
    onChooseSecondAnswer: chooseSecondAnswer,
  };

  return (
    <main className="min-h-dvh overflow-x-clip bg-white text-[#191f28]">
      <header className="sticky top-0 z-30 border-b border-[#edf0f3]/80 bg-white/90 px-5 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-[1120px] items-center justify-between">
          <Link href="/" aria-label="Acttub 홈" className="shrink-0">
            <Image src={wordmark} alt="Acttub" priority className="h-6 w-auto" />
          </Link>
          <div className="flex items-center gap-6">
            <div className="hidden items-center gap-6 text-sm font-semibold text-[#4e5968] md:flex">
              <a
                href="#mini-practice"
                className="transition-colors hover:text-[#191f28] focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#3182f6]"
              >
                연습 방식
              </a>
              <a
                href="#principles"
                className="transition-colors hover:text-[#191f28] focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#3182f6]"
              >
                Acttub의 원칙
              </a>
            </div>
            <Link
              href={practiceLoginHref}
              prefetch={false}
              className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-xl bg-[#3182f6] px-[18px] text-[15px] font-bold tracking-[-0.3px] text-white transition-colors hover:bg-[#1b64da] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3182f6]"
            >
              연습 시작하기
            </Link>
          </div>
        </nav>
      </header>

      <section className="bg-[linear-gradient(180deg,#e8f3ff_0%,#f8fbff_58%,#ffffff_100%)] px-5 pb-16 pt-14 md:pb-28 md:pt-24">
        <div className="mx-auto grid max-w-[1120px] items-center gap-7 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] md:gap-8 xl:grid-cols-[440px_minmax(0,1fr)] xl:gap-11">
          <div className="flex min-w-0 flex-col items-start">
            <p className="text-[13px] font-bold leading-[19px] tracking-[-0.2px] text-[#3182f6] md:text-sm md:leading-5">
              연기 영상 기반 질문 연습
            </p>
            <h1 className="mt-[18px] text-[25px] font-black leading-[29px] tracking-[-1.25px] md:text-[34px] md:leading-[40px] md:tracking-[-1.7px] xl:text-[38px] xl:leading-[43px] xl:tracking-[-1.9px]">
              정답을 정해주지 않고,
              <br />
              다시 보게 합니다.
            </h1>
            <p className="mt-7 text-base font-semibold leading-[26px] text-[#4e5968]">
              영상에서 놓친 순간을 함께 보고 질문을 건네요.
              <br />
              답하다 보면 다음 테이크에서 붙잡을 한 문장이 남습니다.
            </p>
            <div className="mt-9 flex w-full flex-col items-stretch gap-3 xl:flex-row xl:items-center xl:gap-5">
              <Link
                href={practiceLoginHref}
                prefetch={false}
                className="inline-flex h-14 w-full shrink-0 items-center justify-center whitespace-nowrap rounded-2xl bg-[#3182f6] px-7 text-base font-black text-white shadow-[0_8px_20px_rgba(49,130,246,0.24)] transition-colors hover:bg-[#1b64da] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3182f6] xl:w-auto"
              >
                내 영상으로 연습 시작하기
              </Link>
              <a
                href="#mini-practice"
                className="inline-flex min-h-6 items-center whitespace-nowrap text-base font-bold text-[#4e5968] transition-colors hover:text-[#191f28] focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#3182f6]"
              >
                30초로 직접 체험하기 →
              </a>
            </div>
          </div>

          <HeroProductCard />
        </div>
      </section>

      <section
        id="mini-practice"
        className="scroll-mt-16 bg-[#f9fafb] px-5 py-16 md:px-8 md:py-24"
      >
        <div className="mx-auto max-w-[1120px]">
          <h2 className="text-center text-[24px] font-black leading-[31px] tracking-[-1.2px] md:text-[32px] md:leading-[42px] md:tracking-[-1.6px]">
            영상 하나가 연습 노트가 되기까지
          </h2>
          <p className="mx-auto mt-2.5 max-w-[620px] text-center text-base font-semibold leading-[26px] text-[#4e5968]">
            샘플 장면으로 Acttub의 전체 연습 흐름을 직접 따라가 보세요.
          </p>

          <div className="mt-9 md:hidden">
            <MobilePracticeFlow currentStep={journeyStep} {...flowProps} />
          </div>

          <div ref={desktopTrackRef} className="mt-12 hidden h-[900px] md:block">
            <div className="sticky top-20 grid grid-cols-[minmax(180px,240px)_minmax(0,1fr)] items-start gap-6 lg:gap-12">
              <DemoProgress currentStep={desktopStep} />
              <DesktopPracticeScreen currentStep={desktopStep} {...flowProps} />
            </div>
          </div>
        </div>
      </section>

      <section
        id="principles"
        className="scroll-mt-16 bg-white px-5 py-[72px] md:px-8 md:py-28"
      >
        <div className="mx-auto max-w-[1120px]">
          <p className="text-sm font-black text-[#3182f6]">연습 설계 원칙</p>
          <h2 className="mt-3 text-[26px] font-black leading-[35px] tracking-[-1.3px] md:text-[36px] md:leading-[46px] md:tracking-[-1.8px]">
            왜 이런 방식으로 연습하나요?
          </h2>

          <div className="mt-9 grid gap-4 md:grid-cols-3">
            {learningReferences.map((reference, index) => (
              <article
                key={reference.title}
                className="flex min-h-[220px] flex-col rounded-[20px] border border-[#e5e8eb] bg-[#f9fafb] p-6"
              >
                <p className="text-xs font-black text-[#3182f6]">
                  {String(index + 1).padStart(2, "0")}
                </p>
                <h3 className="mt-4 text-xl font-black leading-[30px] tracking-[-0.6px]">
                  {reference.title}
                </h3>
                <p className="mt-auto pt-6 text-[13px] font-semibold leading-[21px] text-[#6b7684]">
                  {reference.source}
                </p>
              </article>
            ))}
          </div>

          <details className="mt-6 rounded-[20px] border border-[#e5e8eb] bg-white px-5 py-1 md:px-6">
            <summary className="cursor-pointer py-5 text-[15px] font-black focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3182f6]">
              참고한 자료 전체 보기
            </summary>
            <div className="grid gap-8 border-t border-[#edf0f3] py-6 md:grid-cols-2">
              <ReferenceGroup title="학습 연구">
                {learningReferences.map((reference) => (
                  <li key={reference.title}>
                    {reference.title} — {reference.source}
                  </li>
                ))}
              </ReferenceGroup>
              <ReferenceGroup title="연기 훈련 서적">
                <li>스타니슬랍스키 『배우 수업』</li>
                <li>우타 하겐 『Respect for Acting』(1973)</li>
                <li>샌포드 마이즈너 『Sanford Meisner on Acting』(1987)</li>
                <li>데클란 도넬란 『The Actor and the Target』(2002)</li>
              </ReferenceGroup>
            </div>
          </details>

          <p className="mt-5 text-sm font-semibold leading-6 text-[#6b7684]">
            위 자료는 Acttub의 질문 구조를 설계할 때 참고한 자료이며, Acttub 자체의 효과를 직접 검증한 연구는 아닙니다.
          </p>
        </div>
      </section>

      <section className="bg-[#f9fafb] px-5 py-[72px] md:px-16 md:py-28">
        <div className="mx-auto max-w-[720px]">
          <p className="text-[15px] font-black text-[#3182f6]">Acttub의 원칙</p>
          <h2 className="mt-4 text-[25px] font-black leading-[33px] tracking-[-1.25px] md:text-[34px] md:leading-[44px] md:tracking-[-1.7px]">
            <span className="md:hidden">정답을 알려주는</span>
            <span className="hidden md:inline">정답을 알려주는 연기 AI가 아닙니다.</span>
            <span className="md:hidden">
              <br />연기 AI가 아닙니다.
            </span>
          </h2>
          <p className="mt-3 text-[19px] font-bold leading-[30px] text-[#4e5968]">
            Acttub은 장면을 단정하지 않아요.
          </p>
          <ul className="mt-8 space-y-1.5">
            {principles.map((principle) => (
              <li
                key={principle.text}
                className="flex items-center gap-3 py-1.5 text-base font-semibold leading-6"
              >
                <span
                  aria-hidden="true"
                  className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-[#f2f4f6] text-xs font-black ${
                    principle.positive ? "text-[#3182f6]" : "text-[#8b95a1]"
                  }`}
                >
                  {principle.mark}
                </span>
                <span>{principle.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="bg-[#191f28] px-5 py-16 text-white md:py-24">
        <div className="mx-auto flex max-w-[1120px] flex-col items-start justify-between gap-6 md:flex-row md:items-center md:gap-10">
          <div className="space-y-4">
            <h2 className="text-[26px] font-black leading-[35px] tracking-[-1.3px] md:text-[48px] md:leading-[60px] md:tracking-[-2.4px]">
              오늘 연기를 그냥 넘기지 마세요
            </h2>
            <p className="text-base font-semibold leading-[26px] text-[#8b95a1]">
              오늘 찍은 장면으로 한 번 더 연습해보세요.
            </p>
          </div>
          <Link
            href={practiceLoginHref}
            prefetch={false}
            className="inline-flex h-16 w-full shrink-0 items-center justify-center rounded-2xl bg-white px-8 text-lg font-black text-[#191f28] transition-colors hover:bg-[#f2f4f6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white md:w-auto"
          >
            내 영상으로 연습 시작하기
          </Link>
        </div>
      </section>

      <footer className="border-t border-[#e5e8eb] bg-white px-5 py-6 md:px-11 md:py-[26px]">
        <div className="mx-auto flex max-w-[1120px] items-center justify-between gap-3.5">
          <p className="text-[15px] font-black">Acttub</p>
          <div className="flex items-center gap-4 text-xs font-semibold">
            <Link
              href="/terms"
              className="text-[#4e5968] transition-colors hover:text-[#191f28] focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#3182f6]"
            >
              이용약관 보기
            </Link>
            <p className="text-[#8b95a1]">© 2026 Acttub</p>
          </div>
        </div>
      </footer>
    </main>
  );
}

type FlowProps = {
  sampleReady: boolean;
  blockageDraft: string;
  chosenBlockage: string | null;
  directEntry: boolean;
  firstAnswer: string | null;
  secondAnswer: string | null;
  noteDiscovery: string;
  onUseSample: () => void;
  onSelectBlockage: (choice: (typeof blockageChoices)[number]) => void;
  onWriteBlockage: (value: string) => void;
  onStartQuestions: () => void;
  onChooseFirstAnswer: (answer: string) => void;
  onChooseSecondAnswer: (answer: string) => void;
};

function HeroProductCard() {
  return (
    <div className="flex w-full max-w-[560px] min-w-0 flex-col gap-3 justify-self-end rounded-[20px] bg-[#f7faff] p-3 shadow-[0_16px_44px_0_#191f281f]">
      <div className="rounded-[18px] bg-white p-3 shadow-[0_12px_36px_rgba(25,31,40,0.05)]">
        <SampleStill
          className="aspect-video w-full rounded-xl bg-black object-contain"
          showChips
          priority
        />
      </div>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[18px] bg-white shadow-[0_12px_36px_rgba(25,31,40,0.06)] sm:rounded-[20px]">
        <div className="flex items-center gap-3 border-b border-[#edf0f3] px-4 py-3 sm:px-5">
          <span className="flex items-center gap-2 text-xs font-black text-[#4e5968] sm:text-[13.5px]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#03b26c]" />
            현재 장면을 바탕으로 질문하고 있어요
          </span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3.5 sm:p-4">
          <div className="mt-auto flex flex-col gap-3 sm:gap-4">
            <div className="flex items-end gap-2 justify-start">
              <span
                aria-hidden="true"
                className="h-7 w-7 shrink-0 rounded-full bg-[linear-gradient(225deg,#44c0fd,#0355f1)]"
              />
              <div className="max-w-[82%] whitespace-pre-wrap rounded-[18px] rounded-bl-[6px] bg-[#f8fbff] px-4 py-3 text-[15px] font-semibold leading-[1.7] text-[#191f28]">
                <span className="block text-xs font-black text-[#3182f6]">
                  관찰 시점 · 00:31
                </span>
                이 대사를 하기 직전, 상대에게서 무엇을 듣고 싶었던 것 같나요?
              </div>
            </div>
          </div>
        </div>
        <div className="border-t border-[#edf0f3] p-3 sm:p-3.5">
          <div className="flex items-center gap-2.5">
            <input
              readOnly
              aria-label="답변 입력 예시"
              value="미안하다는 말을 기다렸던 것 같아요"
              className="h-12 min-w-0 flex-1 rounded-full border border-[#e5e8eb] bg-[#f8fbff] px-5 text-base font-semibold outline-none transition placeholder:text-[#b0b8c1] focus:border-[#3182f6] focus:bg-white disabled:bg-[#f2f4f6] sm:h-14"
            />
            <button
              type="button"
              aria-label="답변 보내기 예시"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#3182f6] text-lg font-black text-white shadow-[0_8px_20px_rgba(49,130,246,0.24)] transition hover:bg-[#1b64da] disabled:bg-[#c9d3df] disabled:shadow-none sm:h-14 sm:w-14"
            >
              ↑
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function SampleStill({
  className,
  showChips = false,
  filename = "take_03.mov",
  priority = false,
}: {
  className: string;
  showChips?: boolean;
  filename?: string;
  priority?: boolean;
}) {
  return (
    <div className={`relative overflow-hidden bg-[#d1d6db] ${className}`}>
      <Image
        src="/landing/sample-take.png"
        alt="침실에서 장면을 연기 중인 배우의 샘플 셀프테이프"
        fill
        priority={priority}
        sizes="(min-width: 768px) 640px, calc(100vw - 72px)"
        className="object-cover object-center"
      />
      {showChips ? (
        <>
          <span className="absolute right-3.5 top-3.5 rounded-lg bg-black/55 px-2.5 py-1 text-[11px] font-bold text-white">
            00:31
          </span>
          <span className="absolute bottom-3.5 left-3.5 max-w-[calc(100%_-_28px)] truncate rounded-lg bg-black/55 px-2.5 py-1 text-[11px] font-bold text-white">
            {filename}
          </span>
        </>
      ) : null}
    </div>
  );
}

function DemoProgress({ currentStep }: { currentStep: DemoStep }) {
  return (
    <div className="pt-3">
      <p className="text-xs font-black tracking-[-0.2px] text-[#6b7684]">
        전체 연습 흐름
      </p>
      <ol className="mt-5 space-y-1" aria-label="체험 단계">
        {demoSteps.map((step, index) => {
          const active = currentStep === index;
          return (
            <li
              key={step.number}
              aria-current={active ? "step" : undefined}
              className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-[15px] font-black transition-colors ${
                active ? "bg-[#e8f3ff] text-[#3182f6]" : "text-[#8b95a1]"
              }`}
            >
              <span className="text-xs">{step.number}</span>
              <span>{step.name}</span>
            </li>
          );
        })}
      </ol>
      <p className="mt-5 text-[13px] font-semibold leading-5 text-[#8b95a1]">
        천천히 스크롤하거나 화면 안에서 선택해 다음 단계로 넘어가세요.
      </p>
    </div>
  );
}

function DesktopPracticeScreen({
  currentStep,
  ...flowProps
}: FlowProps & { currentStep: DemoStep }) {
  return (
    <div
      data-session-step={currentStep + 1}
      className="relative h-[600px] w-full max-w-[640px] min-w-0 justify-self-end overflow-hidden rounded-[20px] border border-[#e5e8eb] bg-white shadow-[0_16px_44px_0_#191f281f]"
      aria-live="polite"
    >
      <SessionPanel active={currentStep === 0}>
        <UploadStepContent
          compact={false}
          interactive={currentStep === 0}
          sampleReady={flowProps.sampleReady}
          onUseSample={flowProps.onUseSample}
        />
      </SessionPanel>
      <SessionPanel active={currentStep === 1}>
        <BlockageStepContent
          compact={false}
          interactive={currentStep === 1 && flowProps.sampleReady}
          {...flowProps}
        />
      </SessionPanel>
      <SessionPanel active={currentStep === 2}>
        <QuestionStepContent
          compact={false}
          interactive={currentStep === 2}
          {...flowProps}
        />
      </SessionPanel>
      <SessionPanel active={currentStep === 3}>
        <NoteStepContent
          compact={false}
          interactive={currentStep === 3}
          {...flowProps}
        />
      </SessionPanel>
    </div>
  );
}

function SessionPanel({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      aria-hidden={!active}
      className={`absolute inset-0 bg-white transition-opacity duration-[250ms] ease-linear motion-reduce:duration-0 ${
        active ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      {children}
    </div>
  );
}

function MobilePracticeFlow({
  currentStep,
  ...flowProps
}: FlowProps & { currentStep: DemoStep }) {
  return (
    <div className="space-y-5">
      <MobileStepCard step={0} currentStep={currentStep}>
        <UploadStepContent
          compact
          interactive
          sampleReady={flowProps.sampleReady}
          onUseSample={flowProps.onUseSample}
        />
      </MobileStepCard>
      <MobileStepCard step={1} currentStep={currentStep}>
        <BlockageStepContent
          compact
          interactive={flowProps.sampleReady}
          {...flowProps}
        />
      </MobileStepCard>
      <MobileStepCard step={2} currentStep={currentStep}>
        <QuestionStepContent compact interactive {...flowProps} />
      </MobileStepCard>
      <MobileStepCard step={3} currentStep={currentStep}>
        <NoteStepContent compact interactive {...flowProps} />
      </MobileStepCard>
    </div>
  );
}

function MobileStepCard({
  step,
  currentStep,
  children,
}: {
  step: DemoStep;
  currentStep: DemoStep;
  children: React.ReactNode;
}) {
  const active = step === currentStep;
  return (
    <article className="overflow-hidden rounded-[20px] border border-[#e5e8eb] bg-white shadow-[0_12px_32px_0_#191f2812]">
      <div
        className={`flex items-center gap-3 border-b border-[#edf0f3] px-4 py-4 text-[15px] font-black ${
          active ? "bg-[#e8f3ff] text-[#3182f6]" : "text-[#8b95a1]"
        }`}
        aria-current={active ? "step" : undefined}
      >
        <span className="text-xs">{demoSteps[step].number}</span>
        <span>{demoSteps[step].name}</span>
      </div>
      {children}
    </article>
  );
}

function UploadStepContent({
  compact,
  interactive,
  sampleReady,
  onUseSample,
}: {
  compact: boolean;
  interactive: boolean;
  sampleReady: boolean;
  onUseSample: () => void;
}) {
  return (
    <div className={compact ? "bg-[#f7faff] p-4" : "flex h-full flex-col bg-[#f7faff] p-6"}>
      {!compact ? <ScreenLabel number="01" name="영상 넣기" /> : null}
      {sampleReady ? (
        <FadeIn>
          <div className={compact ? "" : "mt-5"}>
            <SampleStill
              className="aspect-video max-h-[300px] w-full rounded-[18px] bg-black object-contain sm:rounded-[20px]"
              showChips
              filename="sample_take.mp4"
            />
            <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[#8b95a1]">
                sample_take.mp4
              </span>
              <p className="text-sm font-bold text-[#4e5968]">샘플 영상이 준비됐어요.</p>
            </div>
          </div>
        </FadeIn>
      ) : (
        <div
          className={`${compact ? "h-[200px]" : "mt-5 min-h-[200px] flex-1"} flex w-full flex-col items-center justify-center gap-2 rounded-[18px] border-[1.5px] border-dashed border-[#cfe0f5] bg-[#f8fbff] px-4 text-center transition hover:border-[#3182f6] hover:bg-[#e8f3ff] sm:rounded-[20px]`}
        >
          {/* 넣을 자리에 들어갈 영상을 그대로 채운다.
              ＋ 배지까지 함께 두면 이미 있는 상태와 비어 있는 상태가 겹쳐 보인다. */}
          <SampleStill
            className="aspect-video w-full max-w-[200px] rounded-xl sm:max-w-[360px]"
            filename="sample_take.mp4"
            showChips
          />
          <p className="mt-1 block text-[15px] font-black tracking-[-0.02em] text-[#333d4b] sm:text-[17px]">
            연기 영상을 여기에 넣어요
          </p>
          <p className="block text-xs font-semibold text-[#8b95a1] sm:text-[13px]">
            MP4 · MOV · 5분 이내 · 끌어다 놓아도 돼요
          </p>
        </div>
      )}
      <button
        type="button"
        tabIndex={interactive ? 0 : -1}
        disabled={!interactive}
        onClick={onUseSample}
        className="mt-4 h-12 w-full rounded-[14px] bg-[#3182f6] px-6 text-[15px] font-black text-white shadow-[0_10px_24px_rgba(49,130,246,0.24)] transition hover:bg-[#1b64da] disabled:bg-[#c9d3df] disabled:shadow-none sm:w-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3182f6] disabled:cursor-default"
      >
        {sampleReady ? "샘플 영상 다시 보기" : "샘플 영상으로 체험하기"}
      </button>
    </div>
  );
}

function BlockageStepContent({
  compact,
  interactive,
  sampleReady,
  blockageDraft,
  directEntry,
  onSelectBlockage,
  onWriteBlockage,
  onStartQuestions,
}: FlowProps & { compact: boolean; interactive: boolean }) {
  const canStart = blockageDraft.trim().length > 0;
  return (
    <div className={compact ? "bg-[#f7faff] p-4" : "flex h-full flex-col overflow-y-auto bg-[#f7faff] p-5"}>
      {!compact ? <ScreenLabel number="02" name="막힌 지점 적기" /> : null}
      {sampleReady ? (
        <UploadedSampleStrip compact={compact} />
      ) : (
        <p className={`${compact ? "" : "mt-3"} text-[13px] font-semibold text-[#8b95a1]`}>
          01에서 샘플 영상을 먼저 준비해 주세요.
        </p>
      )}
      <p
        className="mt-3 text-base font-black leading-6 tracking-[-0.4px]"
      >
        이 장면을 연습하면서 가장 마음에 걸린 부분은 무엇인가요?
      </p>
      <div className="mt-3 grid gap-4">
        {blockageChoices.map((choice) => {
          const selected =
            choice === "직접 적기" ? directEntry : blockageDraft === choice;
          return (
            <BlockageChoiceButton
              key={choice}
              text={choice}
              selected={selected}
              disabled={!interactive}
              onClick={() => onSelectBlockage(choice)}
            />
          );
        })}
      </div>
      <textarea
        rows={1}
        value={blockageDraft}
        readOnly={!directEntry}
        disabled={!interactive}
        onChange={(event) => onWriteBlockage(event.target.value)}
        placeholder={
          directEntry
            ? "마음에 걸린 부분을 직접 적어 주세요"
            : "예: 마지막 대사가 갑자기 튀는 것 같아요"
        }
        aria-label="마음에 걸린 부분"
        className="mt-2.5 h-12 w-full resize-none overflow-y-auto rounded-[28px] bg-white p-4 text-base font-semibold leading-6 text-[#191f28] shadow-[0_16px_48px_rgba(25,31,40,0.08)] outline-none placeholder:text-[#4e5968] focus:ring-2 focus:ring-[#3182f6] disabled:bg-[#f8fbff]"
      />
      <button
        type="button"
        tabIndex={interactive ? 0 : -1}
        disabled={!interactive || !canStart}
        onClick={onStartQuestions}
        className="mt-2.5 h-12 w-full rounded-[14px] bg-[#3182f6] px-6 text-[15px] font-black text-white shadow-[0_10px_24px_rgba(49,130,246,0.24)] transition hover:bg-[#1b64da] disabled:bg-[#c9d3df] disabled:shadow-none sm:w-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3182f6] disabled:cursor-not-allowed"
      >
        질문 시작하기
      </button>
    </div>
  );
}

function UploadedSampleStrip({ compact }: { compact: boolean }) {
  return (
    <div
      className={`${compact ? "" : "mt-3"} flex min-w-0 items-center gap-3 rounded-[18px] bg-white p-2.5 shadow-[0_12px_36px_rgba(25,31,40,0.05)]`}
    >
      <div className="relative h-10 w-[72px] shrink-0 overflow-hidden rounded-lg bg-[#d1d6db]">
        <Image
          src="/landing/sample-take.png"
          alt="침실에서 장면을 연기 중인 배우의 샘플 셀프테이프"
          fill
          sizes="72px"
          className="object-cover object-center"
        />
      </div>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-black">sample_take.mp4</p>
        <p className="mt-1 text-xs font-bold text-[#6b7684]">00:31</p>
      </div>
    </div>
  );
}

function QuestionStepContent({
  compact,
  interactive,
  chosenBlockage,
  firstAnswer,
  secondAnswer,
  onChooseFirstAnswer,
  onChooseSecondAnswer,
}: FlowProps & { compact: boolean; interactive: boolean }) {
  const ready = Boolean(chosenBlockage);
  const sendSuggestedAnswer = () => {
    if (!firstAnswer) {
      onChooseFirstAnswer(firstAnswerChoices[0]);
      return;
    }
    if (!secondAnswer) onChooseSecondAnswer(secondAnswerChoices[0]);
  };

  return (
    <div className={compact ? "bg-[#f7faff] p-4" : "flex h-full min-h-0 flex-col bg-[#f7faff] p-5"}>
      {!compact ? <ScreenLabel number="03" name="질문으로 풀기" /> : null}
      <section className={`${compact ? "min-h-[560px]" : "mt-3"} flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[18px] bg-white shadow-[0_12px_36px_rgba(25,31,40,0.06)] sm:rounded-[20px]`}>
        <div className="flex items-center gap-3 border-b border-[#edf0f3] px-4 py-3 sm:px-5">
          <span className="flex items-center gap-2 text-xs font-black text-[#4e5968] sm:text-[13.5px]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#03b26c]" />
            현재 장면을 바탕으로 질문하고 있어요
          </span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3.5 sm:p-4">
          <div className="mt-auto flex flex-col gap-3 sm:gap-4">
            <DemoCoachBubble
              eyebrow="지금 풀고 있는 지점"
              text={chosenBlockage ?? "02에서 마음에 걸린 부분을 먼저 골라 주세요."}
            />
            <DemoCoachBubble
              eyebrow="영상에서 확인된 순간 · 00:31"
              text="마지막 대사 직전, 시선이 아래로 내려가고 잠시 멈춰 있어요."
            />
            <DemoCoachBubble
              eyebrow="질문 1"
              text="이 말을 하기 직전, 상대에게서 어떤 반응을 기대했나요?"
            />
            {firstAnswer ? (
              <DemoMineBubble text={firstAnswer} />
            ) : (
              <div className="flex flex-col items-end gap-2">
                {firstAnswerChoices.map((answer) => (
                  <DemoAnswerButton
                    key={answer}
                    text={answer}
                    disabled={!interactive || !ready}
                    onClick={() => onChooseFirstAnswer(answer)}
                  />
                ))}
              </div>
            )}
            {firstAnswer ? (
              <FadeIn>
                <div className="flex flex-col gap-3 sm:gap-4">
                  <DemoCoachBubble
                    eyebrow="질문 2"
                    text="그 기대가 시선과 멈춤에 드러난다면, 다음에는 무엇을 해볼까요?"
                  />
                  {secondAnswer ? (
                    <DemoMineBubble text={secondAnswer} />
                  ) : (
                    <div className="flex flex-col items-end gap-2">
                      {secondAnswerChoices.map((answer) => (
                        <DemoAnswerButton
                          key={answer}
                          text={answer}
                          disabled={!interactive}
                          onClick={() => onChooseSecondAnswer(answer)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </FadeIn>
            ) : null}
          </div>
        </div>
        <div className="border-t border-[#edf0f3] p-3 sm:p-3.5">
          <div className="flex items-center gap-2.5">
            <input
              readOnly
              disabled={!interactive || !ready || Boolean(secondAnswer)}
              aria-label="체험 답변 입력"
              placeholder="아래 답변 중 하나를 골라 주세요"
              className="h-12 min-w-0 flex-1 rounded-full border border-[#e5e8eb] bg-[#f8fbff] px-5 text-base font-semibold outline-none transition placeholder:text-[#b0b8c1] focus:border-[#3182f6] focus:bg-white disabled:bg-[#f2f4f6] sm:h-14"
            />
            <button
              type="button"
              disabled={!interactive || !ready || Boolean(secondAnswer)}
              onClick={sendSuggestedAnswer}
              aria-label="추천 답변 보내기"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#3182f6] text-lg font-black text-white shadow-[0_8px_20px_rgba(49,130,246,0.24)] transition hover:bg-[#1b64da] disabled:bg-[#c9d3df] disabled:shadow-none sm:h-14 sm:w-14"
            >
              ↑
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function NoteStepContent({
  compact,
  interactive,
  chosenBlockage,
  firstAnswer,
  secondAnswer,
  noteDiscovery,
}: FlowProps & { compact: boolean; interactive: boolean }) {
  return (
    <div className={compact ? "bg-[#f7faff] p-4" : "flex h-full min-h-0 flex-col bg-[#f7faff] p-5"}>
      {!compact ? <ScreenLabel number="04" name="연습 노트 받기" /> : null}
      <div className={`${compact ? "" : "mt-4"} min-h-0 flex-1 overflow-y-auto`}>
        {/* 마지막 문장이 잘리면 체험의 결말이 사라진다. 노트가 스크롤 없이 들어가도록 묶어 둔다. */}
        <div className="grid gap-3">
          <header className="rounded-[28px] bg-[#3182f6] px-6 py-4 text-white shadow-[0_16px_48px_rgba(25,31,40,0.08)]">
            <p className="text-xs font-black">오늘 정리</p>
            <h2 className="mt-1 text-xl font-black leading-tight tracking-[-0.04em]">
              연습 노트
            </h2>
          </header>
          <NoteRow
            label="처음 막힌 지점"
            text={chosenBlockage ?? "02에서 고른 문장이 여기에 이어져요."}
          />
          <NoteRow
            label="대화에서 발견한 것"
            text={
              firstAnswer ? `“${firstAnswer}”\n${noteDiscovery}` : noteDiscovery
            }
          />
          <NoteRow
            label="다음 테이크에서 붙잡을 문장"
            text={secondAnswer ?? "시선을 피하지 않고 한 박자 더 기다려요."}
          />
        </div>
      </div>
      <Link
        href={practiceLoginHref}
        prefetch={false}
        tabIndex={interactive ? 0 : -1}
        className="mt-4 inline-flex h-12 w-full shrink-0 items-center justify-center rounded-[14px] bg-[#3182f6] px-4 text-[15px] font-black text-white transition-colors hover:bg-[#1b64da] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3182f6]"
      >
        내 영상으로 같은 방식으로 연습하기 →
      </Link>
    </div>
  );
}

function ScreenLabel({ number, name }: { number: string; name: string }) {
  return (
    <p className="text-[13px] font-black text-[#3182f6]">
      {number} {name}
    </p>
  );
}

function BlockageChoiceButton({
  text,
  selected = false,
  disabled = false,
  onClick,
}: {
  text: string;
  selected?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={`min-h-10 w-full rounded-[28px] bg-white px-6 py-2 text-left shadow-[0_16px_48px_rgba(25,31,40,0.08)] transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3182f6] disabled:cursor-not-allowed disabled:text-[#b0b8c1] ${selected ? "ring-2 ring-[#3182f6]" : ""}`}
    >
      <span className="block text-lg font-black text-[#191f28]">{text}</span>
    </button>
  );
}

function DemoCoachBubble({ eyebrow, text }: { eyebrow: string; text: string }) {
  return (
    <div className="flex items-end gap-2 justify-start">
      <span
        aria-hidden="true"
        className="h-7 w-7 shrink-0 rounded-full bg-[linear-gradient(225deg,#44c0fd,#0355f1)]"
      />
      <div className="max-w-[82%] whitespace-pre-wrap rounded-[18px] px-4 py-3 text-[15px] font-semibold leading-[1.7] rounded-bl-[6px] bg-[#f8fbff] text-[#191f28]">
        <span className="block text-xs font-black text-[#3182f6]">{eyebrow}</span>
        {text}
      </div>
    </div>
  );
}

function DemoMineBubble({ text }: { text: string }) {
  return (
    <div className="flex items-end gap-2 justify-end">
      <div className="max-w-[82%] whitespace-pre-wrap rounded-[18px] px-4 py-3 text-[15px] font-semibold leading-[1.7] rounded-br-[6px] bg-[#3182f6] text-white">
        {text}
      </div>
    </div>
  );
}

function DemoAnswerButton({
  text,
  disabled,
  onClick,
}: {
  text: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex w-full items-end gap-2 justify-end">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="max-w-[82%] whitespace-pre-wrap rounded-[18px] px-4 py-3 text-left text-[15px] font-semibold leading-[1.7] rounded-br-[6px] bg-[#3182f6] text-white transition hover:bg-[#1b64da] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3182f6] disabled:cursor-not-allowed disabled:bg-[#c9d3df]"
      >
        {text}
      </button>
    </div>
  );
}

function NoteRow({ label, text }: { label: string; text: string }) {
  return (
    <article className="rounded-[28px] bg-white p-5 shadow-[0_16px_48px_rgba(25,31,40,0.08)]">
      <h3 className="text-base font-black text-[#191f28]">{label}</h3>
      <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-7 text-[#4e5968]">
        {text}
      </p>
    </article>
  );
}

function ReferenceGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-[15px] font-black">{title}</h3>
      <ul className="mt-3 space-y-2 text-[13px] font-semibold leading-[21px] text-[#4e5968]">
        {children}
      </ul>
    </div>
  );
}

function FadeIn({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  return (
    <div
      className={`transition-opacity duration-[250ms] ease-linear motion-reduce:duration-0 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      {children}
    </div>
  );
}
