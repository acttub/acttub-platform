"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import wordmark from "../assets/acttub-wordmark.png";
import { isLoggedIn } from "../lib/auth/token-store";

const practiceLoginHref = "/login?next=/practice/new";

const observedMoment =
  "마지막 말을 한 뒤, 상대를 바라보며 2초 동안 멈춰 있어요.";
const firstPrompt = "그 2초 동안, 상대가 어떤 말을 해주길 기다렸나요?";
const followUpPrompt =
  "그렇다면 이 인물은 정말 떠나려는 걸까요, 아니면 붙잡히기를 기다리는 걸까요?";

const closingCopy = {
  discovery:
    "떠나겠다고 말하지만, 상대가 나를 한 번 더 붙잡아주기를 기다리고 있었다.",
  nextTake: "마지막 대사를 한 뒤, 시선을 피하지 않고 2초 더 기다린다.",
};

const secondBranches = [
  { answer: "정말 떠나려 한다", closing: closingCopy },
  { answer: "붙잡히길 기다린다", closing: closingCopy },
  { answer: "두 마음이 같이 있다", closing: closingCopy },
] as const;

const miniSessionBranches = [
  {
    answer: "가지 말라고",
    followUp: { prompt: followUpPrompt, branches: secondBranches },
  },
  {
    answer: "미안하다고",
    followUp: { prompt: followUpPrompt, branches: secondBranches },
  },
  {
    answer: "내가 맞았다고",
    followUp: { prompt: followUpPrompt, branches: secondBranches },
  },
  {
    answer: "잘 모르겠어요",
    followUp: { prompt: followUpPrompt, branches: secondBranches },
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

type SessionStep = 0 | 1 | 2 | 3 | 4;

export default function LandingClient() {
  const router = useRouter();
  const desktopTrackRef = useRef<HTMLDivElement>(null);
  const [scrollStep, setScrollStep] = useState<0 | 1 | 2>(0);
  const [chosenFirst, setChosenFirst] = useState<string | null>(null);
  const [chosenSecond, setChosenSecond] = useState<string | null>(null);
  const [chosenStep, setChosenStep] = useState<3 | 4 | null>(null);

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
      const scrollDistance = Math.max(track.offsetHeight - 560, 1);
      const progress = Math.min(Math.max((96 - bounds.top) / scrollDistance, 0), 1);
      const nextStep: 0 | 1 | 2 = progress < 0.34 ? 0 : progress < 0.67 ? 1 : 2;

      setScrollStep((currentStep) =>
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

  const selectedBranch =
    miniSessionBranches.find((branch) => branch.answer === chosenFirst) ??
    miniSessionBranches[0];
  const selectedClosing =
    selectedBranch.followUp.branches.find(
      (branch) => branch.answer === chosenSecond,
    )?.closing ?? closingCopy;
  const visibleStep: SessionStep = chosenStep ?? scrollStep;

  const chooseFirst = (answer: string) => {
    setChosenFirst(answer);
    setChosenSecond(null);
    setChosenStep(3);
  };

  const chooseSecond = (answer: string) => {
    setChosenSecond(answer);
    setChosenStep(4);
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
              className="inline-flex h-10 items-center justify-center rounded-xl bg-[#3182f6] px-[18px] text-[15px] font-bold tracking-[-0.3px] text-white transition-colors hover:bg-[#1b64da] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3182f6]"
            >
              연습 시작하기
            </Link>
          </div>
        </nav>
      </header>

      <section className="bg-[linear-gradient(180deg,#eaf6ff_0%,#f8fbff_58%,#ffffff_100%)] px-5 pb-16 pt-14 md:pb-28 md:pt-24">
        <div className="mx-auto grid max-w-[1120px] items-center gap-7 md:grid-cols-[376px_minmax(0,1fr)] md:gap-11">
          <div className="flex flex-col items-start">
            <p className="text-[13px] font-bold leading-[19px] tracking-[-0.2px] text-[#3182f6] md:text-sm md:leading-5">
              연기 영상 기반 질문 연습
            </p>
            <h1 className="mt-[18px] text-[25px] font-black leading-[29px] tracking-[-1.25px] md:text-[38px] md:leading-[43px] md:tracking-[-1.9px]">
              정답을 정해주지 않고,
              <br />
              다시 보게 합니다.
            </h1>
            <p className="mt-7 text-base font-semibold leading-[26px] text-[#4e5968]">
              영상에서 놓친 순간을 함께 보고 질문을 건네요.
              <br />
              답하다 보면 다음 테이크에서 붙잡을 한 문장이 남습니다.
            </p>
            <div className="mt-9 flex w-full flex-col items-start gap-3 md:flex-row md:items-center md:gap-5">
              <Link
                href={practiceLoginHref}
                prefetch={false}
                className="inline-flex h-14 w-full items-center justify-center rounded-2xl bg-[#3182f6] px-7 text-base font-black text-white shadow-[0_8px_20px_-4px_#0a79fb40] transition-colors hover:bg-[#1b64da] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3182f6] md:w-auto"
              >
                내 영상으로 연습 시작하기
              </Link>
              <a
                href="#mini-practice"
                className="inline-flex min-h-6 items-center text-base font-bold text-[#4e5968] transition-colors hover:text-[#191f28] focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#3182f6]"
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
        className="scroll-mt-16 bg-[#f9fafb] px-5 py-16 md:px-11 md:py-24"
      >
        <div className="mx-auto max-w-[840px]">
          <h2 className="text-center text-[24px] font-black leading-[31px] tracking-[-1.2px] md:text-[32px] md:leading-[42px] md:tracking-[-1.6px]">
            지금, 이 장면을 한 번 다시 볼까요?
          </h2>
          <p className="mt-2.5 text-center text-base font-semibold leading-[26px] text-[#4e5968]">
            샘플 장면을 보며 Acttub의 질문에 직접 답해보세요.
          </p>

          <div className="mt-9 md:hidden">
            <MiniBadge />
            <MobileMiniSession
              chosenFirst={chosenFirst}
              chosenSecond={chosenSecond}
              selectedBranch={selectedBranch}
              selectedClosing={selectedClosing}
              onChooseFirst={chooseFirst}
              onChooseSecond={chooseSecond}
            />
          </div>

          <div ref={desktopTrackRef} className="mt-9 hidden h-[1500px] md:block">
            <div className="sticky top-24 flex flex-col items-center gap-5">
              <MiniBadge />
              <DesktopMiniSession
                step={visibleStep}
                chosenFirst={chosenFirst}
                chosenSecond={chosenSecond}
                selectedBranch={selectedBranch}
                selectedClosing={selectedClosing}
                onChooseFirst={chooseFirst}
                onChooseSecond={chooseSecond}
              />
            </div>
          </div>
        </div>
      </section>

      <section
        id="principles"
        className="scroll-mt-16 bg-white px-5 py-[72px] md:px-16 md:py-28"
      >
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

function HeroProductCard() {
  return (
    <div className="w-full max-w-[560px] justify-self-end overflow-hidden rounded-[20px] border border-[#e5e8eb] bg-white shadow-[0_16px_44px_0_#191f281f]">
      <SampleStill className="aspect-video" showChips priority />
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-end gap-2">
          <span
            aria-hidden="true"
            className="h-6 w-6 shrink-0 rounded-full bg-[linear-gradient(135deg,#44c0fd_14.645%,#0355f1_85.355%)]"
          />
          <div className="flex-1 rounded-[14px_14px_14px_4px] bg-[#e8f3ff] p-3">
            <p className="inline-flex rounded-full bg-white px-[9px] py-[3px] text-[11px] font-bold text-[#3182f6]">
              관찰 시점 · 00:31
            </p>
            <p className="mt-2 text-sm font-bold leading-[22px]">
              이 대사를 하기 직전, 상대에게서 무엇을 듣고 싶었던 것 같나요?
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2" aria-label="답변 입력 예시">
          <div className="flex h-10 flex-1 items-center rounded-full bg-[#f2f4f6] px-4 text-[13px] font-semibold text-[#8b95a1]">
            답을 편하게 적어 주세요
          </div>
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#3182f6] text-base font-black text-white"
          >
            ↑
          </span>
        </div>
      </div>
    </div>
  );
}

function SampleStill({
  className,
  showChips = false,
  priority = false,
  decorative = false,
}: {
  className: string;
  showChips?: boolean;
  priority?: boolean;
  decorative?: boolean;
}) {
  return (
    <div className={`relative overflow-hidden bg-[#d1d6db] ${className}`}>
      <Image
        src="/landing/sample-take.png"
        alt={decorative ? "" : "침실에서 장면을 연기 중인 배우의 샘플 셀프테이프"}
        fill
        priority={priority}
        sizes="(min-width: 768px) 560px, calc(100vw - 40px)"
        className="object-cover object-center"
      />
      {showChips ? (
        <>
          <span className="absolute right-3.5 top-3.5 rounded-lg bg-black/50 px-2.5 py-1 text-[11px] font-bold text-white">
            00:31
          </span>
          <span className="absolute bottom-3.5 left-3.5 rounded-lg bg-black/50 px-2.5 py-1 text-[11px] font-bold text-white">
            take_03.mov
          </span>
        </>
      ) : null}
    </div>
  );
}

function MiniBadge() {
  return (
    <p className="mx-auto w-fit rounded-full bg-[#e8f3ff] px-3 py-[7px] text-xs font-bold tracking-[-0.2px] text-[#3182f6]">
      샘플 장면으로 체험 중
    </p>
  );
}

function DesktopMiniSession({
  step,
  chosenFirst,
  chosenSecond,
  selectedBranch,
  selectedClosing,
  onChooseFirst,
  onChooseSecond,
}: {
  step: SessionStep;
  chosenFirst: string | null;
  chosenSecond: string | null;
  selectedBranch: (typeof miniSessionBranches)[number];
  selectedClosing: typeof closingCopy;
  onChooseFirst: (answer: string) => void;
  onChooseSecond: (answer: string) => void;
}) {
  return (
    <div
      id="mini-session-card"
      data-session-step={step + 1}
      className="relative h-[480px] w-[560px] overflow-hidden rounded-[20px] border border-[#e5e8eb] bg-white shadow-[0_16px_44px_0_#191f281f]"
      aria-live="polite"
    >
      <SessionPanel active={step === 0}>
        <SampleStill className="h-[315px]" />
      </SessionPanel>

      <SessionPanel active={step === 1}>
        <SampleStill className="h-[315px]" decorative />
        <Observation className="p-5" />
      </SessionPanel>

      <SessionPanel active={step === 2}>
        <SampleStill className="h-20" decorative />
        <div className="flex flex-col gap-3 p-5">
          <p className="text-[17px] font-bold leading-[27px] tracking-[-0.4px]">
            {firstPrompt}
          </p>
          <ChoiceButtons
            choices={miniSessionBranches}
            onChoose={onChooseFirst}
            interactive={step === 2}
          />
        </div>
      </SessionPanel>

      <SessionPanel active={step === 3}>
        <SampleStill className="h-20" decorative />
        <div className="flex flex-col gap-3 p-5">
          <AnswerBubble text={chosenFirst ?? miniSessionBranches[0].answer} />
          <p className="text-base font-bold leading-[26px] tracking-[-0.4px]">
            {selectedBranch.followUp.prompt}
          </p>
          <ChoiceButtons
            choices={selectedBranch.followUp.branches}
            onChoose={onChooseSecond}
            interactive={step === 3}
          />
        </div>
      </SessionPanel>

      <SessionPanel active={step === 4}>
        <ClosingView
          chosenFirst={chosenFirst}
          chosenSecond={chosenSecond}
          closing={selectedClosing}
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

function Observation({ className }: { className: string }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <p className="text-[13px] font-extrabold tracking-[-0.2px] text-[#3182f6]">
        영상에서 확인된 순간
      </p>
      <p className="text-[17px] font-semibold leading-[27px] tracking-[-0.4px]">
        {observedMoment}
      </p>
    </div>
  );
}

function ChoiceButtons({
  choices,
  onChoose,
  interactive = true,
}: {
  choices: readonly { answer: string }[];
  onChoose: (answer: string) => void;
  interactive?: boolean;
}) {
  return (
    <div className="flex w-full flex-col gap-2">
      {choices.map((choice) => (
        <button
          key={choice.answer}
          type="button"
          tabIndex={interactive ? 0 : -1}
          onClick={() => onChoose(choice.answer)}
          className="flex h-[42px] w-full items-center rounded-xl border border-[#e5e8eb] px-3.5 text-left text-[15px] font-semibold tracking-[-0.3px] transition-colors hover:border-[#3182f6] hover:bg-[#f9fafb] focus-visible:border-[#3182f6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3182f6]"
        >
          {choice.answer}
        </button>
      ))}
    </div>
  );
}

function AnswerBubble({ text }: { text: string }) {
  return (
    <div className="flex w-full justify-end">
      <p className="w-fit rounded-[14px] bg-[#3182f6] px-3.5 py-2.5 text-sm font-semibold tracking-[-0.3px] text-white">
        {text}
      </p>
    </div>
  );
}

function ClosingView({
  chosenFirst,
  chosenSecond,
  closing,
}: {
  chosenFirst: string | null;
  chosenSecond: string | null;
  closing: typeof closingCopy;
}) {
  return (
    <div className="flex h-full flex-col justify-center gap-4 p-6">
      <div className="space-y-2">
        {chosenFirst ? <AnswerBubble text={chosenFirst} /> : null}
        {chosenSecond ? <AnswerBubble text={chosenSecond} /> : null}
      </div>
      <div className="space-y-2">
        <p className="text-[13px] font-extrabold tracking-[-0.2px] text-[#6b7684]">
          내가 발견한 것
        </p>
        <p className="text-[17px] font-semibold leading-[27px] tracking-[-0.4px] text-[#4e5968]">
          {closing.discovery}
        </p>
      </div>
      <div className="space-y-2">
        <p className="text-[13px] font-extrabold tracking-[-0.2px] text-[#3182f6]">
          다음 테이크
        </p>
        <p className="text-[20px] font-extrabold leading-8 tracking-[-0.4px]">
          {closing.nextTake}
        </p>
      </div>
      <Link
        href={practiceLoginHref}
        prefetch={false}
        tabIndex={chosenSecond ? 0 : -1}
        className="inline-flex h-12 w-full shrink-0 items-center justify-center rounded-[14px] bg-[#3182f6] text-[15px] font-extrabold tracking-[-0.3px] text-white transition-colors hover:bg-[#1b64da] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3182f6]"
      >
        내 영상으로 이어서 연습하기
      </Link>
    </div>
  );
}

function MobileMiniSession({
  chosenFirst,
  chosenSecond,
  selectedBranch,
  selectedClosing,
  onChooseFirst,
  onChooseSecond,
}: {
  chosenFirst: string | null;
  chosenSecond: string | null;
  selectedBranch: (typeof miniSessionBranches)[number];
  selectedClosing: typeof closingCopy;
  onChooseFirst: (answer: string) => void;
  onChooseSecond: (answer: string) => void;
}) {
  return (
    <div className="mt-5 overflow-hidden rounded-[20px] border border-[#e5e8eb] bg-white shadow-[0_16px_44px_0_#191f281f]">
      <SampleStill className="aspect-video" />
      <Observation className="border-b border-[#edf0f3] p-4" />
      <div className="flex flex-col gap-3 p-4">
        <p className="text-[16px] font-bold leading-[26px] tracking-[-0.4px]">
          {firstPrompt}
        </p>
        <ChoiceButtons choices={miniSessionBranches} onChoose={onChooseFirst} />
      </div>

      {chosenFirst ? (
        <FadeIn>
          <div className="flex flex-col gap-3 border-t border-[#edf0f3] p-4">
            <AnswerBubble text={chosenFirst} />
            <p className="text-[16px] font-bold leading-[26px] tracking-[-0.4px]">
              {selectedBranch.followUp.prompt}
            </p>
            <ChoiceButtons
              choices={selectedBranch.followUp.branches}
              onChoose={onChooseSecond}
            />
          </div>
        </FadeIn>
      ) : null}

      {chosenSecond ? (
        <FadeIn>
          <div className="border-t border-[#edf0f3]">
            <ClosingView
              chosenFirst={null}
              chosenSecond={chosenSecond}
              closing={selectedClosing}
            />
          </div>
        </FadeIn>
      ) : null}
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
