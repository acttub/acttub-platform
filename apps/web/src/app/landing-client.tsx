"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
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

const principleGroups = [
  {
    title: "하지 않습니다",
    items: [
      { mark: "×", text: "연기를 심사하지 않습니다", positive: false },
      { mark: "×", text: "해석을 먼저 정하지 않습니다", positive: false },
    ],
  },
  {
    title: "합니다",
    items: [
      { mark: "✓", text: "영상 속 순간에서 질문합니다", positive: true },
      { mark: "✓", text: "마지막 선택은 배우가 만듭니다", positive: true },
    ],
  },
] as const;

type DemoStep = 0 | 1 | 2 | 3;

export default function LandingClient() {
  const router = useRouter();
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
    <main className="min-h-dvh overflow-x-clip bg-white text-text-strong">
      <header className="sticky top-0 z-30 bg-white/80 px-5 backdrop-blur-xl">
        <nav className="mx-auto flex h-14 max-w-[1120px] items-center justify-between">
          <Link href="/" aria-label="Acttub 홈" className="shrink-0">
            <Image src={wordmark} alt="Acttub" priority className="h-[22px] w-auto" />
          </Link>
          <Link
            href={practiceLoginHref}
            prefetch={false}
            className="inline-flex h-11 items-center justify-center whitespace-nowrap rounded-xl bg-link px-4 py-3 text-body-sm font-emphasis text-white transition-colors hover:bg-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
          >
            내 영상으로 시작하기
          </Link>
        </nav>
      </header>

      <section className="bg-linear-to-b from-link-soft via-surface-subtle to-white px-5 pb-16 pt-14 md:pb-28 md:pt-24">
        <div className="mx-auto grid max-w-[1120px] items-center gap-7 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] md:gap-8 xl:grid-cols-[440px_minmax(0,1fr)] xl:gap-11">
          <div className="flex min-w-0 flex-col items-start">
            <h1 className="text-display font-heading tracking-[-0.04em]">
              혼자 찍은 연기,
              <br />
              혼자만 보고 끝내고 있나요?
            </h1>
            <p className="mt-6 text-body font-body text-text-body">
              영상을 올리고 막힌 지점을 적으면,
              <br />
              Acttub이 장면 속 순간을 짚어 질문합니다.
              <br />
              답하다 보면 다음 테이크에서 붙잡을 한 문장이 남습니다.
            </p>
            <div className="mt-8 flex w-full flex-col items-stretch gap-3 xl:flex-row xl:items-center xl:gap-5">
              <a
                href="#mini-practice"
                className="inline-flex h-14 w-full shrink-0 items-center justify-center whitespace-nowrap rounded-2xl bg-link px-7 text-body font-emphasis text-white shadow-[0_8px_20px_rgba(49,130,246,0.24)] transition-colors hover:bg-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link xl:w-auto"
              >
                샘플 영상으로 30초 체험하기
              </a>
              <Link
                href={practiceLoginHref}
                prefetch={false}
                className="inline-flex h-12 items-center whitespace-nowrap py-3 text-body font-emphasis text-text-body transition-colors hover:text-text-strong focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-link"
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
        className="scroll-mt-14 bg-surface-subtle px-5 py-10 md:px-8 md:py-[72px]"
      >
        <div className="mx-auto max-w-[1120px]">
          <h2 className="text-center text-h2 font-heading tracking-[-0.04em]">
            영상 하나가 연습 노트가 되기까지
          </h2>
          <p className="mx-auto mt-2.5 max-w-[620px] text-center text-body font-body text-text-body">
            샘플 장면으로 Acttub의 전체 연습 흐름을 직접 따라가 보세요.
          </p>

          <p className="mt-9 text-label font-emphasis text-text-muted md:mx-auto md:w-[864px]">
            전체 연습 흐름
          </p>
          <div className="mt-5">
            <PracticeFlow currentStep={journeyStep} {...flowProps} />
          </div>
          <div className="mt-10 flex justify-center md:mt-14">
            <a
              href="#mini-practice"
              className="inline-flex h-14 w-full items-center justify-center rounded-2xl bg-link px-7 text-body font-emphasis text-white shadow-[0_8px_20px_rgba(49,130,246,0.24)] transition-colors hover:bg-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link sm:w-auto"
            >
              샘플 영상으로 30초 체험하기
            </a>
          </div>
        </div>
      </section>

      <section
        id="principles"
        className="scroll-mt-14 bg-white px-5 py-[72px] md:px-8 md:py-24"
      >
        <div className="mx-auto max-w-[1120px]">
          <p className="text-body-sm font-emphasis text-link">연습 설계 원칙</p>
          <h2 className="mt-3 text-display font-heading tracking-[-0.04em]">
            정답을 정해주지 않고,
            <br />
            다시 보게 합니다.
          </h2>

          <h3 className="mt-10 text-h2 font-heading tracking-[-0.03em] md:mt-12">
            왜 질문으로 연습하나요?
          </h3>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {learningReferences.map((reference) => (
              <article
                key={reference.title}
                className="flex min-h-[210px] flex-col rounded-[28px] border border-border-default bg-surface-subtle p-6"
              >
                <h4 className="text-h3 font-heading tracking-[-0.03em]">
                  {reference.title}
                </h4>
                <p className="mt-3 text-body font-body text-text-body">
                  {reference.description}
                </p>
                <a
                  href="#references"
                  className="mt-auto pt-6 text-caption font-emphasis text-link underline underline-offset-4 transition-colors hover:text-link-hover focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
                >
                  {reference.linkLabel}
                </a>
              </article>
            ))}
          </div>

          <details
            id="references"
            className="mt-6 scroll-mt-20 rounded-[20px] border border-border-default bg-white px-5 py-1 md:px-6"
          >
            <summary className="cursor-pointer py-5 text-body font-emphasis focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link">
              참고한 자료 전체 보기
            </summary>
            <ul className="space-y-2 border-t border-border-subtle py-6 text-caption font-body text-text-body">
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

          <p className="mt-5 text-body-sm font-body text-text-muted">
            위 자료는 Acttub의 질문 구조를 설계할 때 참고한 자료이며, Acttub 자체의 효과를 직접 검증한 연구는 아닙니다.
          </p>

          <div className="mt-12 rounded-[28px] bg-surface-subtle p-6 md:mt-16 md:p-8">
            <h3 className="text-h3 font-heading tracking-[-0.03em]">
              Acttub이 하는 것과 하지 않는 것
            </h3>
            <div className="mt-5 grid gap-7 md:grid-cols-2 md:gap-10">
              {principleGroups.map((group) => (
                <section key={group.title}>
                  <h4 className="text-label font-emphasis text-text-muted">
                    {group.title}
                  </h4>
                  <ul className="mt-2 grid gap-1.5">
                    {group.items.map((principle) => (
                      <li
                        key={principle.text}
                        className="flex items-center gap-3 py-1.5 text-body font-emphasis text-text-strong"
                      >
                        <span
                          aria-hidden="true"
                          className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-white text-label font-emphasis ${
                            principle.positive ? "text-link" : "text-text-muted"
                          }`}
                        >
                          {principle.mark}
                        </span>
                        <span>{principle.text}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-text-strong px-5 py-16 text-white md:py-24">
        <div className="mx-auto flex max-w-[1120px] flex-col items-start justify-between gap-6 md:flex-row md:items-center md:gap-10">
          <div className="space-y-4">
            <h2 className="text-h2 font-heading tracking-[-0.04em]">
              오늘 찍은 장면을
              <br />
              그냥 저장해두지 마세요.
            </h2>
            <p className="text-body font-body text-text-disabled">
              로그인 없이, 샘플 영상으로 30초 만에 확인할 수 있어요.
            </p>
          </div>
          <Link
            href={practiceLoginHref}
            prefetch={false}
            className="inline-flex h-16 w-full shrink-0 items-center justify-center rounded-2xl bg-white px-8 text-h3 font-emphasis text-text-strong transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white md:w-auto"
          >
            내 영상으로 시작하기
          </Link>
        </div>
      </section>

      <footer className="border-t border-border-default bg-white px-5 py-6 md:px-11 md:py-[26px]">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-x-2 text-body-sm font-body text-text-muted">
          <p className="font-emphasis text-text-strong">Acttub</p>
          <span aria-hidden="true">·</span>
          <Link
            href="/terms"
            className="inline-flex h-11 items-center font-emphasis text-text-body transition-colors hover:text-text-strong focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-link"
          >
            이용약관
          </Link>
          <span aria-hidden="true">·</span>
          <p>© 2026 Acttub</p>
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
    <div className="flex w-full max-w-[560px] min-w-0 flex-col gap-3 justify-self-end rounded-[20px] bg-surface-subtle p-3 shadow-[0_12px_36px_rgba(25,31,40,0.06)]">
      <div className="rounded-[18px] bg-white p-3 shadow-[0_12px_36px_rgba(25,31,40,0.05)]">
        <SampleStill
          className="aspect-video w-full rounded-xl bg-black object-contain"
          showChips
          priority
        />
      </div>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[18px] bg-white shadow-[0_12px_36px_rgba(25,31,40,0.06)] sm:rounded-[20px]">
        <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-3 sm:px-5">
          <span className="flex items-center gap-2 text-label font-emphasis text-text-body sm:text-body-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-[#03b26c]" />
            현재 장면을 바탕으로 질문하고 있어요
          </span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3.5 sm:p-4">
          <div className="mt-auto flex flex-col gap-3 sm:gap-4">
            <div className="flex items-end gap-2 justify-start">
              <span
                aria-hidden="true"
                className="h-7 w-7 shrink-0 rounded-full bg-linear-to-br from-link to-link-hover"
              />
              <div className="max-w-[82%] whitespace-pre-wrap rounded-[18px] rounded-bl-[6px] bg-surface-subtle px-4 py-3 text-body font-body text-text-strong">
                <span className="block text-label font-emphasis text-link">
                  관찰 시점 · 00:31
                </span>
                이 대사를 하기 직전, 상대에게서 무엇을 듣고 싶었던 것 같나요?
              </div>
            </div>
          </div>
        </div>
        <div className="border-t border-border-subtle p-3 sm:p-3.5">
          <div className="flex items-center gap-2.5">
            <input
              readOnly
              aria-label="답변 입력 예시"
              value="미안하다는 말을 기다렸던 것 같아요"
              className="h-12 min-w-0 flex-1 rounded-full border border-border-default bg-surface-subtle px-5 text-body font-body outline-none transition placeholder:text-text-muted focus:border-link focus:bg-white disabled:bg-surface-muted sm:h-14"
            />
            <button
              type="button"
              aria-label="답변 보내기 예시"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-link text-h3 font-emphasis text-white shadow-[0_8px_20px_rgba(49,130,246,0.24)] transition hover:bg-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link disabled:bg-control-disabled disabled:shadow-none sm:h-14 sm:w-14"
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
    <div className={`relative overflow-hidden bg-media-placeholder ${className}`}>
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
          <span className="absolute right-3.5 top-3.5 rounded-lg bg-black/55 px-2.5 py-1 text-label font-emphasis text-white">
            00:31
          </span>
          <span className="absolute bottom-3.5 left-3.5 max-w-[calc(100%_-_28px)] truncate rounded-lg bg-black/55 px-2.5 py-1 text-label font-emphasis text-white">
            {filename}
          </span>
        </>
      ) : null}
    </div>
  );
}

function PracticeFlow({
  currentStep,
  ...flowProps
}: FlowProps & { currentStep: DemoStep }) {
  return (
    <div className="space-y-10 md:space-y-20" aria-label="체험 단계">
      <PracticeStepArticle step={0} currentStep={currentStep}>
        <UploadStepContent
          interactive
          sampleReady={flowProps.sampleReady}
          onUseSample={flowProps.onUseSample}
        />
      </PracticeStepArticle>
      <PracticeStepArticle step={1} currentStep={currentStep}>
        <BlockageStepContent
          interactive={flowProps.sampleReady}
          {...flowProps}
        />
      </PracticeStepArticle>
      <PracticeStepArticle step={2} currentStep={currentStep}>
        <QuestionStepContent interactive {...flowProps} />
      </PracticeStepArticle>
      <PracticeStepArticle step={3} currentStep={currentStep}>
        <NoteStepContent {...flowProps} />
      </PracticeStepArticle>
    </div>
  );
}

function PracticeStepArticle({
  step,
  currentStep,
  children,
}: {
  step: DemoStep;
  currentStep: DemoStep;
  children: React.ReactNode;
}) {
  const active = step === currentStep;
  const completed = step < currentStep;
  return (
    <article className="grid items-start gap-2.5 md:grid-cols-[200px_minmax(0,640px)] md:justify-center md:gap-6">
      <div
        className="flex items-center gap-3 py-2.5 md:sticky md:top-20 md:py-3"
        aria-current={active ? "step" : undefined}
      >
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-label font-emphasis ${
            completed || active
              ? "bg-link text-white"
              : "bg-surface-muted text-text-disabled"
          }`}
        >
          {demoSteps[step].number}
        </span>
        <span
          className={`text-label font-emphasis sm:text-caption ${
            completed || active ? "text-text-strong" : "text-text-disabled"
          }`}
        >
          {demoSteps[step].name}
        </span>
      </div>
      <div className="min-w-0 overflow-hidden rounded-[20px] bg-white shadow-[0_12px_36px_rgba(25,31,40,0.05)]">
        {children}
      </div>
    </article>
  );
}

function UploadStepContent({
  interactive,
  sampleReady,
  onUseSample,
}: {
  interactive: boolean;
  sampleReady: boolean;
  onUseSample: () => void;
}) {
  return (
    <div className="bg-surface-subtle p-3.5 md:p-5">
      {sampleReady ? (
        <FadeIn>
          <div
            className="rounded-[18px] border-[1.5px] border-dashed border-link-soft bg-white p-3 sm:rounded-[20px]"
          >
            <SampleStill
              className="aspect-video w-full rounded-xl bg-black object-contain"
              showChips
              filename="sample_take.mp4"
            />
            <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
              <span className="min-w-0 flex-1 truncate text-label font-body text-text-muted">
                sample_take.mp4
              </span>
              <p className="text-label font-emphasis text-text-body">샘플 영상이 준비됐어요.</p>
            </div>
          </div>
          <div className="mt-3">
            <SceneRowsExample />
          </div>
        </FadeIn>
      ) : (
        <div
          className="flex w-full flex-col items-center justify-center gap-1.5 rounded-[18px] border-[1.5px] border-dashed border-link-soft bg-white px-4 py-5 text-center transition hover:border-link hover:bg-link-soft sm:rounded-[20px]"
        >
          {/* 넣을 자리에 들어갈 영상을 그대로 채운다.
              ＋ 배지까지 함께 두면 이미 있는 상태와 비어 있는 상태가 겹쳐 보인다. */}
          <SampleStill
            className="aspect-video w-full max-w-[300px] rounded-xl md:max-w-none"
            filename="sample_take.mp4"
            showChips
          />
          <p className="block text-body font-emphasis tracking-[-0.02em] text-text-strong">
            연기 영상을 여기에 넣어요
          </p>
          <p className="block text-label font-body text-text-muted sm:text-caption">
            MP4 · MOV · 5분 이내 · 끌어다 놓아도 돼요
          </p>
        </div>
      )}
      <button
        type="button"
        tabIndex={interactive ? 0 : -1}
        disabled={!interactive}
        onClick={onUseSample}
        className="mt-3 h-11 w-full rounded-[14px] bg-link px-6 text-body font-emphasis text-white shadow-[0_10px_24px_rgba(49,130,246,0.24)] transition hover:bg-link-hover disabled:bg-control-disabled disabled:shadow-none sm:w-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link disabled:cursor-default"
      >
        {sampleReady ? "샘플 영상 다시 보기" : "샘플 영상으로 체험하기"}
      </button>
    </div>
  );
}

function SceneRowsExample() {
  const rows = [
    ["상황", "이별을 통보받은 직후, 카페에서"],
    ["인물", "담담한 척하는 20대 후반 여성"],
    ["목표", "상대가 마음을 돌려 다시 앉게 만들기"],
  ] as const;

  return (
    <section className="rounded-[18px] bg-white p-4 shadow-[0_12px_36px_rgba(25,31,40,0.05)] sm:rounded-[20px] sm:p-6">
      <h2 className="text-body font-heading tracking-[-0.03em]">
        이 장면에서 무엇을 연기했는지 알려 주세요
      </h2>
      <dl className="mt-3 grid gap-3">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="grid gap-1.5 sm:grid-cols-[56px_minmax(0,1fr)] sm:items-center sm:gap-3"
          >
            <dt className="text-label font-emphasis text-text-strong">{label}</dt>
            <dd className="flex h-11 w-full items-center rounded-xl border border-border-default bg-surface-subtle px-3.5 text-body font-body text-text-strong">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function BlockageStepContent({
  interactive,
  sampleReady,
  blockageDraft,
  directEntry,
  onSelectBlockage,
  onWriteBlockage,
  onStartQuestions,
}: FlowProps & { interactive: boolean }) {
  const [showAllChoices, setShowAllChoices] = useState(false);
  const canStart = blockageDraft.trim().length > 0;
  const visibleChoices = showAllChoices
    ? blockageChoices
    : blockageChoices.slice(0, 2);

  return (
    <div className="bg-surface-subtle p-3.5 md:p-5">
      {sampleReady ? (
        <UploadedSampleStrip />
      ) : (
        <p className="text-caption font-body text-text-muted">
          01에서 샘플 영상을 먼저 준비해 주세요.
        </p>
      )}
      <p
        className="mt-3 text-body font-emphasis tracking-[-0.025em]"
      >
        이 장면을 연습하면서 가장 마음에 걸린 부분은 무엇인가요?
      </p>
      <div className="mt-3 grid gap-2">
        {visibleChoices.map((choice) => {
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
        <MoreChoicesButton
          expanded={showAllChoices}
          disabled={!interactive}
          onClick={() => setShowAllChoices((current) => !current)}
        />
      </div>
      {directEntry ? (
        <textarea
          rows={1}
          value={blockageDraft}
          disabled={!interactive}
          onChange={(event) => onWriteBlockage(event.target.value)}
          placeholder="마음에 걸린 부분을 직접 적어 주세요"
          aria-label="마음에 걸린 부분"
          className="mt-2.5 h-11 w-full resize-none overflow-y-auto rounded-xl border border-border-default bg-white px-4 py-2.5 text-body font-body text-text-strong outline-none placeholder:text-text-body focus:border-link focus:ring-2 focus:ring-link-soft disabled:bg-surface-subtle"
        />
      ) : null}
      <button
        type="button"
        tabIndex={interactive ? 0 : -1}
        disabled={!interactive || !canStart}
        onClick={onStartQuestions}
        className="mt-2.5 h-11 w-full rounded-[14px] bg-link px-6 text-body font-emphasis text-white shadow-[0_10px_24px_rgba(49,130,246,0.24)] transition hover:bg-link-hover disabled:bg-control-disabled disabled:shadow-none sm:w-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link disabled:cursor-not-allowed"
      >
        질문 시작하기
      </button>
    </div>
  );
}

function UploadedSampleStrip() {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-[18px] bg-white p-2 shadow-[0_12px_36px_rgba(25,31,40,0.05)]">
      <div className="relative h-10 w-[72px] shrink-0 overflow-hidden rounded-lg bg-media-placeholder">
        <Image
          src="/landing/sample-take.png"
          alt="침실에서 장면을 연기 중인 배우의 샘플 셀프테이프"
          fill
          sizes="72px"
          className="object-cover object-center"
        />
      </div>
      <div className="min-w-0">
        <p className="truncate text-caption font-emphasis">sample_take.mp4</p>
        <p className="mt-1 text-label font-emphasis text-text-muted">00:31</p>
      </div>
    </div>
  );
}

function SessionContext({ blockage }: { blockage: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3 border-b border-border-subtle bg-surface-subtle px-3 py-2.5 sm:px-4">
      <div className="relative h-9 w-16 shrink-0 overflow-hidden rounded-lg bg-media-placeholder">
        <Image
          src="/landing/sample-take.png"
          alt="00:31 샘플 장면"
          fill
          sizes="64px"
          className="object-cover object-center"
        />
      </div>
      <div className="min-w-0">
        <p className="text-label font-emphasis text-link">
          02에서 고른 막힌 지점 · 00:31
        </p>
        <p className="truncate text-caption font-emphasis text-text-strong">
          {blockage}
        </p>
      </div>
    </div>
  );
}

function QuestionStepContent({
  interactive,
  chosenBlockage,
  activeBlockage,
  firstAnswer,
  secondAnswer,
  onChooseFirstAnswer,
  onChooseSecondAnswer,
}: FlowProps & { interactive: boolean }) {
  const [showAllFirstAnswers, setShowAllFirstAnswers] = useState(false);
  const [showAllSecondAnswers, setShowAllSecondAnswers] = useState(false);
  const ready = Boolean(chosenBlockage);
  const sendSuggestedAnswer = () => {
    if (!firstAnswer) {
      onChooseFirstAnswer(firstAnswerChoices[0]);
      return;
    }
    if (!secondAnswer) onChooseSecondAnswer(secondAnswerChoices[0]);
  };

  return (
    <div className="bg-surface-subtle p-3.5 md:p-5">
      <section className="flex min-h-[260px] min-w-0 flex-col overflow-hidden rounded-[18px] bg-white shadow-[0_12px_36px_rgba(25,31,40,0.06)] sm:rounded-[20px]">
        <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-3 sm:px-5">
          <span className="flex items-center gap-2 text-label font-emphasis text-text-body">
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
                {(showAllFirstAnswers
                  ? firstAnswerChoices
                  : firstAnswerChoices.slice(0, 2)
                ).map((answer) => (
                  <DemoAnswerButton
                    key={answer}
                    text={answer}
                    disabled={!interactive || !ready}
                    onClick={() => onChooseFirstAnswer(answer)}
                  />
                ))}
                <MoreChoicesButton
                  expanded={showAllFirstAnswers}
                  disabled={!interactive || !ready}
                  onClick={() =>
                    setShowAllFirstAnswers((current) => !current)
                  }
                />
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
                      {(showAllSecondAnswers
                        ? secondAnswerChoices
                        : secondAnswerChoices.slice(0, 2)
                      ).map((answer) => (
                        <DemoAnswerButton
                          key={answer}
                          text={answer}
                          disabled={!interactive}
                          onClick={() => onChooseSecondAnswer(answer)}
                        />
                      ))}
                      <MoreChoicesButton
                        expanded={showAllSecondAnswers}
                        disabled={!interactive}
                        onClick={() =>
                          setShowAllSecondAnswers((current) => !current)
                        }
                      />
                    </div>
                  )}
                </div>
              </FadeIn>
            ) : null}
          </div>
        </div>
        <div className="border-t border-border-subtle p-3 sm:p-3.5">
          <div className="flex items-center gap-2.5">
            <input
              readOnly
              disabled={!interactive || !ready || Boolean(secondAnswer)}
              aria-label="체험 답변 입력"
              placeholder="아래 답변 중 하나를 골라 주세요"
              className="h-12 min-w-0 flex-1 rounded-full border border-border-default bg-surface-subtle px-5 text-body font-body outline-none transition placeholder:text-text-muted focus:border-link focus:bg-white disabled:bg-surface-muted sm:h-14"
            />
            <button
              type="button"
              disabled={!interactive || !ready || Boolean(secondAnswer)}
              onClick={sendSuggestedAnswer}
              aria-label="추천 답변 보내기"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-link text-h3 font-emphasis text-white shadow-[0_8px_20px_rgba(49,130,246,0.24)] transition hover:bg-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link disabled:bg-control-disabled disabled:shadow-none sm:h-14 sm:w-14"
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
  activeBlockage,
  secondAnswer,
  noteDiscovery,
}: FlowProps) {
  const nextTakeSentence =
    secondAnswer ?? "시선을 피하지 않고 한 박자 더 기다려요.";

  return (
    <div className="bg-surface-subtle p-3.5 md:p-5">
      <div>
        <article className="rounded-[28px] bg-white p-4 shadow-[0_16px_48px_rgba(25,31,40,0.08)] sm:p-5">
          <span className="inline-flex items-center rounded-lg bg-link-soft px-2.5 py-1 text-label font-emphasis text-link">
            00:31 장면 다시 보기
          </span>

          <div className="mt-3 rounded-[18px] bg-surface-subtle px-4 py-3">
            <p className="text-label font-emphasis text-text-muted">
              처음 막힌 지점
            </p>
            <p className="mt-1 text-body font-body text-text-strong">
              {activeBlockage}
            </p>
          </div>

          <div className="mt-4">
            <h3 className="text-body font-heading text-text-strong">
              오늘 발견한 것
            </h3>
            <p className="mt-1.5 text-body font-body text-text-body">
              {noteDiscovery}
            </p>
          </div>

          <div className="mt-4 rounded-[20px] bg-link-soft p-4">
            <h3 className="text-label font-emphasis text-link">
              다음 테이크에서 붙잡을 한 문장
            </h3>
            <blockquote className="mt-2 text-h2 font-heading tracking-[-0.04em] text-text-strong">
              “{nextTakeSentence}”
            </blockquote>
          </div>
        </article>
      </div>
    </div>
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
      className={`min-h-10 w-full rounded-xl border border-border-default bg-white px-4 py-2 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link disabled:cursor-not-allowed disabled:opacity-60 ${selected ? "border-link ring-2 ring-link-soft" : ""}`}
    >
      <span className="block text-body font-emphasis text-text-strong">
        {text}
      </span>
    </button>
  );
}

function MoreChoicesButton({
  expanded,
  disabled,
  onClick,
}: {
  expanded: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={expanded ? "선택지 접기" : "다른 선택지 보기"}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex min-h-10 w-14 items-center justify-center self-end rounded-xl border border-border-default bg-white text-caption font-emphasis text-text-muted transition hover:border-link hover:text-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link disabled:cursor-not-allowed disabled:opacity-60"
    >
      …
    </button>
  );
}

function DemoCoachBubble({ eyebrow, text }: { eyebrow: string; text: string }) {
  return (
    <div className="flex items-end gap-2 justify-start">
      <span
        aria-hidden="true"
        className="h-7 w-7 shrink-0 rounded-full bg-linear-to-br from-link to-link-hover"
      />
      <div className="max-w-[82%] whitespace-pre-wrap rounded-[18px] rounded-bl-[6px] bg-surface-subtle px-4 py-3 text-body font-body text-text-strong">
        <span className="block text-label font-emphasis text-link">{eyebrow}</span>
        {text}
      </div>
    </div>
  );
}

function DemoMineBubble({ text }: { text: string }) {
  return (
    <div className="flex items-end gap-2 justify-end">
      <div className="max-w-[82%] whitespace-pre-wrap rounded-[18px] rounded-br-[6px] bg-link px-4 py-3 text-body font-body text-white">
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
        className="max-w-[82%] whitespace-pre-wrap rounded-[18px] rounded-br-[6px] bg-link px-4 py-3 text-left text-body font-body text-white transition hover:bg-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link disabled:cursor-not-allowed disabled:bg-control-disabled"
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
