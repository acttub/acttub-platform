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
  "직접 적기",
] as const;

const sampleBlockage = blockageChoices[0];

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
};

const defaultDiscovery =
  "시선이 머무는 순간과 마지막 대사 사이에 상대의 반응을 기다리는 마음이 있었어요.";

const learningReferences = [
  {
    title: "장면을 다시 보게 합니다",
    description:
      "영상의 특정 순간을 보며 당시의 생각과 선택을 떠올립니다.",
    linkLabel: "자극 회상 연구 참고 →",
    source:
      "자극 회상(stimulated recall) 기법 · Schön, 『The Reflective Practitioner』(1983)",
  },
  {
    title: "스스로 말하게 합니다",
    description:
      "해석을 먼저 알려주기보다 질문을 통해 자기 언어로 설명하게 합니다.",
    linkLabel: "자기설명 효과 연구 참고 →",
    source: "Chi 외, 자기설명 효과 · Cognitive Science (1989·1994)",
  },
  {
    title: "다음 테이크로 가져갑니다",
    description:
      "대화를 끝내는 대신 다음 시도에서 확인할 행동 하나를 남깁니다.",
    linkLabel: "의도적 연습·목표 설정 연구 참고 →",
    source:
      "Ericsson 외, 의도적 연습 · Psychological Review (1993) · Locke & Latham 목표 설정 이론",
  },
] as const;

const principles = [
  { mark: "×", text: "연기를 심사하지 않습니다", positive: false },
  {
    mark: "×",
    text: "해석을 먼저 정하지 않습니다",
    positive: false,
  },
  {
    mark: "✓",
    text: "영상 속 순간에서 질문합니다",
    positive: true,
  },
  {
    mark: "✓",
    text: "마지막 선택은 배우가 만듭니다",
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
      const scrollDistance = Math.max(track.offsetHeight - 520, 1);
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
  const activeBlockage = chosenBlockage ?? sampleBlockage;
  const noteDiscovery = discoveries[activeBlockage] ?? defaultDiscovery;

  const useSample = () => {
    setSampleReady(true);
    setBlockageDraft(sampleBlockage);
    setChosenBlockage(sampleBlockage);
    setDirectEntry(false);
    setFirstAnswer(null);
    setSecondAnswer(null);
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
    activeBlockage,
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
      <header className="sticky top-0 z-30 bg-white/80 px-5 backdrop-blur-xl">
        <nav className="mx-auto flex h-14 max-w-[1120px] items-center justify-between">
          <Link href="/" aria-label="Acttub 홈" className="shrink-0">
            <Image src={wordmark} alt="Acttub" priority className="h-[22px] w-auto" />
          </Link>
          <Link
            href={practiceLoginHref}
            prefetch={false}
            className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-xl bg-[#3182f6] px-4 text-sm font-bold tracking-[-0.3px] text-white transition-colors hover:bg-[#1b64da] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3182f6]"
          >
            연습 시작하기
          </Link>
        </nav>
      </header>

      <section className="bg-[linear-gradient(180deg,#e8f3ff_0%,#f8fbff_58%,#ffffff_100%)] px-5 pb-16 pt-14 md:pb-28 md:pt-24">
        <div className="mx-auto grid max-w-[1120px] items-center gap-7 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] md:gap-8 xl:grid-cols-[440px_minmax(0,1fr)] xl:gap-11">
          <div className="flex min-w-0 flex-col items-start">
            <h1 className="text-[27px] font-black leading-[33px] tracking-[-1.35px] md:text-[34px] md:leading-[40px] md:tracking-[-1.7px] xl:text-[38px] xl:leading-[43px] xl:tracking-[-1.9px]">
              혼자 찍은 연기,
              <br />
              혼자만 보고 끝내고 있나요?
            </h1>
            <p className="mt-6 text-[15px] font-semibold leading-[25px] text-[#4e5968] md:text-base md:leading-[26px]">
              영상을 올리고 막힌 지점을 적으면,
              <br />
              Acttub이 장면 속 순간을 짚어 질문합니다.
              <br />
              답하다 보면 다음 테이크에서 붙잡을 한 문장이 남습니다.
            </p>
            <div className="mt-8 flex w-full flex-col items-stretch gap-3 xl:flex-row xl:items-center xl:gap-5">
              <a
                href="#mini-practice"
                className="inline-flex h-14 w-full shrink-0 items-center justify-center whitespace-nowrap rounded-2xl bg-[#3182f6] px-7 text-base font-black text-white shadow-[0_8px_20px_rgba(49,130,246,0.24)] transition-colors hover:bg-[#1b64da] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3182f6] xl:w-auto"
              >
                샘플 영상으로 30초 체험하기
              </a>
              <Link
                href={practiceLoginHref}
                prefetch={false}
                className="inline-flex min-h-6 items-center whitespace-nowrap text-base font-bold text-[#4e5968] transition-colors hover:text-[#191f28] focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#3182f6]"
              >
                내 영상으로 시작하기 →
              </Link>
            </div>
          </div>

          <HeroProductCard />
        </div>
      </section>

      <section
        id="mini-practice"
        className="scroll-mt-14 bg-[#f9fafb] px-5 py-10 md:px-8 md:py-[72px]"
      >
        <div className="mx-auto max-w-[1120px]">
          <h2 className="text-center text-[24px] font-black leading-[31px] tracking-[-1.2px] md:text-[32px] md:leading-[42px] md:tracking-[-1.6px]">
            영상 하나가 연습 노트가 되기까지
          </h2>
          <p className="mx-auto mt-2.5 max-w-[620px] text-center text-base font-semibold leading-[26px] text-[#4e5968]">
            샘플 장면으로 Acttub의 전체 연습 흐름을 직접 따라가 보세요.
          </p>

          <div className="mt-6 md:hidden">
            <MobilePracticeFlow currentStep={journeyStep} {...flowProps} />
          </div>

          <div ref={desktopTrackRef} className="mt-9 hidden h-[680px] md:block">
            <div className="sticky top-16 grid grid-cols-[minmax(180px,240px)_minmax(0,1fr)] items-start gap-6 lg:gap-12">
              <DemoProgress currentStep={desktopStep} />
              <DesktopPracticeScreen currentStep={desktopStep} {...flowProps} />
            </div>
          </div>
        </div>
      </section>

      <section
        id="principles"
        className="scroll-mt-14 bg-white px-5 py-[72px] md:px-8 md:py-24"
      >
        <div className="mx-auto max-w-[1120px]">
          <p className="text-sm font-black text-[#3182f6]">연습 설계 원칙</p>
          <h2 className="mt-3 text-[26px] font-black leading-[35px] tracking-[-1.3px] md:text-[36px] md:leading-[46px] md:tracking-[-1.8px]">
            정답을 정해주지 않고,
            <br />
            다시 보게 합니다.
          </h2>

          <h3 className="mt-10 text-xl font-black leading-[30px] tracking-[-0.6px] md:mt-12 md:text-2xl">
            왜 질문으로 연습하나요?
          </h3>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {learningReferences.map((reference) => (
              <article
                key={reference.title}
                className="flex min-h-[210px] flex-col rounded-[28px] border border-[#e5e8eb] bg-[#f9fafb] p-6"
              >
                <h4 className="text-xl font-black leading-[30px] tracking-[-0.6px]">
                  {reference.title}
                </h4>
                <p className="mt-3 text-[15px] font-semibold leading-6 text-[#4e5968]">
                  {reference.description}
                </p>
                <a
                  href="#references"
                  className="mt-auto pt-6 text-[13px] font-semibold leading-[21px] text-[#8b95a1] transition-colors hover:text-[#4e5968] focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3182f6]"
                >
                  {reference.linkLabel}
                </a>
              </article>
            ))}
          </div>

          <details
            id="references"
            className="mt-6 scroll-mt-20 rounded-[20px] border border-[#e5e8eb] bg-white px-5 py-1 md:px-6"
          >
            <summary className="cursor-pointer py-5 text-[15px] font-black focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3182f6]">
              참고한 자료 전체 보기
            </summary>
            <ul className="space-y-2 border-t border-[#edf0f3] py-6 text-[13px] font-semibold leading-[21px] text-[#4e5968]">
              <li>{learningReferences[0].source}</li>
              <li>{learningReferences[1].source}</li>
              <li>{learningReferences[2].source}</li>
              <li>
                연기 훈련 서적: 스타니슬랍스키 『배우 수업』 / 우타 하겐
                『Respect for Acting』(1973) / 샌포드 마이즈너 『Sanford
                Meisner on Acting』(1987) / 데클란 도넬란 『The Actor and the
                Target』(2002)
              </li>
            </ul>
          </details>

          <p className="mt-5 text-sm font-semibold leading-6 text-[#6b7684]">
            위 자료는 Acttub의 질문 구조를 설계할 때 참고한 자료이며, Acttub 자체의 효과를 직접 검증한 연구는 아닙니다.
          </p>

          <div className="mt-12 rounded-[28px] bg-[#f7faff] p-6 md:mt-16 md:p-8">
            <h3 className="text-xl font-black leading-[30px] tracking-[-0.6px]">
              Acttub이 하지 않는 것
            </h3>
            <ul className="mt-5 grid gap-1.5 md:grid-cols-2 md:gap-x-10">
              {principles.map((principle) => (
                <li
                  key={principle.text}
                  className="flex items-center gap-3 py-1.5 text-base font-semibold leading-6"
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-white text-xs font-black ${
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
        </div>
      </section>

      <section className="bg-[#191f28] px-5 py-16 text-white md:py-24">
        <div className="mx-auto flex max-w-[1120px] flex-col items-start justify-between gap-6 md:flex-row md:items-center md:gap-10">
          <div className="space-y-4">
            <h2 className="text-[26px] font-black leading-[35px] tracking-[-1.3px] md:text-[48px] md:leading-[60px] md:tracking-[-2.4px]">
              오늘 찍은 장면을
              <br />
              그냥 저장해두지 마세요.
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
  activeBlockage: string;
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
    <div className="flex w-full max-w-[560px] min-w-0 flex-col gap-3 justify-self-end rounded-[20px] bg-[#f7faff] p-3 shadow-[0_12px_36px_rgba(25,31,40,0.06)]">
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
      className="relative h-[520px] w-full max-w-[640px] min-w-0 justify-self-end overflow-hidden rounded-[20px] border border-[#e5e8eb] bg-white shadow-[0_12px_36px_rgba(25,31,40,0.06)]"
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
    <div className="space-y-2.5">
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
    <article className="overflow-hidden rounded-[20px] border border-[#e5e8eb] bg-white shadow-[0_12px_36px_rgba(25,31,40,0.05)]">
      <div
        className={`flex items-center gap-3 border-b border-[#edf0f3] px-4 py-2.5 text-[15px] font-black ${
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
    <div className={compact ? "bg-[#f7faff] p-3.5" : "flex h-full flex-col bg-[#f7faff] p-4"}>
      {!compact ? <ScreenLabel number="01" name="영상 넣기" /> : null}
      {sampleReady ? (
        <FadeIn>
          <div className={compact ? "" : "mt-3"}>
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
          className={`${compact ? "h-[140px]" : "mt-3 min-h-[160px] flex-1"} flex w-full flex-col items-center justify-center gap-1.5 rounded-[18px] border-[1.5px] border-dashed border-[#cfe0f5] bg-[#f8fbff] px-4 text-center transition hover:border-[#3182f6] hover:bg-[#e8f3ff] sm:rounded-[20px]`}
        >
          {/* 넣을 자리에 들어갈 영상을 그대로 채운다.
              ＋ 배지까지 함께 두면 이미 있는 상태와 비어 있는 상태가 겹쳐 보인다. */}
          <SampleStill
            className="aspect-video w-full max-w-[160px] rounded-xl sm:max-w-[300px]"
            filename="sample_take.mp4"
            showChips
          />
          <p className="block text-[14px] font-black tracking-[-0.02em] text-[#333d4b] sm:text-[16px]">
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
        className="mt-3 h-11 w-full rounded-[14px] bg-[#3182f6] px-6 text-[15px] font-black text-white shadow-[0_10px_24px_rgba(49,130,246,0.24)] transition hover:bg-[#1b64da] disabled:bg-[#c9d3df] disabled:shadow-none sm:w-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3182f6] disabled:cursor-default"
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
    <div className={compact ? "bg-[#f7faff] p-3.5" : "flex h-full flex-col overflow-y-auto bg-[#f7faff] p-4"}>
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
      <div className="mt-3 grid gap-2">
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
      {directEntry ? (
        <textarea
          rows={1}
          value={blockageDraft}
          disabled={!interactive}
          onChange={(event) => onWriteBlockage(event.target.value)}
          placeholder="마음에 걸린 부분을 직접 적어 주세요"
          aria-label="마음에 걸린 부분"
          className="mt-2.5 h-11 w-full resize-none overflow-y-auto rounded-[28px] bg-white px-4 py-2.5 text-[15px] font-semibold leading-6 text-[#191f28] shadow-[0_16px_48px_rgba(25,31,40,0.08)] outline-none placeholder:text-[#4e5968] focus:ring-2 focus:ring-[#3182f6] disabled:bg-[#f8fbff]"
        />
      ) : null}
      <button
        type="button"
        tabIndex={interactive ? 0 : -1}
        disabled={!interactive || !canStart}
        onClick={onStartQuestions}
        className="mt-2.5 h-11 w-full rounded-[14px] bg-[#3182f6] px-6 text-[15px] font-black text-white shadow-[0_10px_24px_rgba(49,130,246,0.24)] transition hover:bg-[#1b64da] disabled:bg-[#c9d3df] disabled:shadow-none sm:w-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3182f6] disabled:cursor-not-allowed"
      >
        질문 시작하기
      </button>
    </div>
  );
}

function UploadedSampleStrip({ compact }: { compact: boolean }) {
  return (
    <div
      className={`${compact ? "" : "mt-2.5"} flex min-w-0 items-center gap-3 rounded-[18px] bg-white p-2 shadow-[0_12px_36px_rgba(25,31,40,0.05)]`}
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

function SessionContext({ blockage }: { blockage: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3 border-b border-[#edf0f3] bg-[#f8fbff] px-3 py-2.5 sm:px-4">
      <div className="relative h-9 w-16 shrink-0 overflow-hidden rounded-lg bg-[#d1d6db]">
        <Image
          src="/landing/sample-take.png"
          alt="00:31 샘플 장면"
          fill
          sizes="64px"
          className="object-cover object-center"
        />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-black text-[#3182f6]">
          02에서 고른 막힌 지점 · 00:31
        </p>
        <p className="truncate text-[13px] font-bold text-[#333d4b]">
          {blockage}
        </p>
      </div>
    </div>
  );
}

function QuestionStepContent({
  compact,
  interactive,
  chosenBlockage,
  activeBlockage,
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
    <div className={compact ? "bg-[#f7faff] p-3.5" : "flex h-full min-h-0 flex-col bg-[#f7faff] p-4"}>
      {!compact ? <ScreenLabel number="03" name="질문으로 풀기" /> : null}
      <section className={`${compact ? "min-h-[260px]" : "mt-2.5"} flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[18px] bg-white shadow-[0_12px_36px_rgba(25,31,40,0.06)] sm:rounded-[20px]`}>
        <div className="flex items-center gap-3 border-b border-[#edf0f3] px-4 py-3 sm:px-5">
          <span className="flex items-center gap-2 text-xs font-black text-[#4e5968] sm:text-[13.5px]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#03b26c]" />
            현재 장면을 바탕으로 질문하고 있어요
          </span>
        </div>
        <SessionContext blockage={activeBlockage} />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 sm:p-3.5">
          <div className="mt-auto flex flex-col gap-2.5 sm:gap-3">
            <DemoCoachBubble
              eyebrow="영상에서 확인된 순간 · 00:31"
              text="마지막 대사 직전, 시선이 아래로 내려가고 잠시 멈춰 있어요."
            />
            <DemoCoachBubble
              eyebrow="질문 1"
              text={`“${activeBlockage}”라고 느낀 이 순간, 상대에게서 어떤 반응을 기대했나요?`}
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
                <div className="flex flex-col gap-2.5 sm:gap-3">
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
  activeBlockage,
  secondAnswer,
  noteDiscovery,
}: FlowProps & { compact: boolean; interactive: boolean }) {
  const nextTakeSentence =
    secondAnswer ?? "시선을 피하지 않고 한 박자 더 기다려요.";

  return (
    <div className={compact ? "bg-[#f7faff] p-3.5" : "flex h-full min-h-0 flex-col bg-[#f7faff] p-4"}>
      {!compact ? <ScreenLabel number="04" name="연습 노트 받기" /> : null}
      <div className={`${compact ? "" : "mt-2.5"} min-h-0 flex-1 overflow-y-auto`}>
        <article className="rounded-[28px] bg-white p-4 shadow-[0_16px_48px_rgba(25,31,40,0.08)] sm:p-5">
          <span className="inline-flex items-center rounded-lg bg-[#e8f3ff] px-2.5 py-1 text-xs font-black text-[#3182f6]">
            00:31 장면 다시 보기
          </span>

          <div className="mt-3 rounded-[18px] bg-[#f8fbff] px-4 py-3">
            <p className="text-[11px] font-black text-[#8b95a1]">
              처음 막힌 지점
            </p>
            <p className="mt-1 text-sm font-bold leading-5 text-[#333d4b]">
              {activeBlockage}
            </p>
          </div>

          <div className="mt-4">
            <h3 className="text-sm font-black text-[#191f28]">
              오늘 발견한 것
            </h3>
            <p className="mt-1.5 text-sm font-semibold leading-6 text-[#4e5968]">
              {noteDiscovery}
            </p>
          </div>

          <div className="mt-4 rounded-[20px] bg-[#e8f3ff] p-4">
            <h3 className="text-xs font-black text-[#3182f6]">
              다음 테이크에서 붙잡을 한 문장
            </h3>
            <blockquote className="mt-2 text-[25px] font-black leading-[32px] tracking-[-1px] text-[#191f28] md:text-[30px] md:leading-[38px] md:tracking-[-1.5px]">
              “{nextTakeSentence}”
            </blockquote>
          </div>
        </article>
      </div>
      <Link
        href={practiceLoginHref}
        prefetch={false}
        tabIndex={interactive ? 0 : -1}
        className="mt-3 inline-flex h-11 w-full shrink-0 items-center justify-center rounded-[14px] bg-[#3182f6] px-4 text-[15px] font-black text-white transition-colors hover:bg-[#1b64da] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3182f6]"
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
      className={`min-h-10 w-full rounded-[28px] bg-white px-5 py-2 text-left shadow-[0_16px_48px_rgba(25,31,40,0.08)] transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3182f6] disabled:cursor-not-allowed disabled:text-[#b0b8c1] ${selected ? "ring-2 ring-[#3182f6]" : ""}`}
    >
      <span className="block text-[15px] font-black leading-6 text-[#191f28]">
        {text}
      </span>
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
