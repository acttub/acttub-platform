"use client";

import { useState } from "react";
import {
  BLOCKAGE_CHOICES,
  BLOCKAGE_DETAIL_TITLE,
  blockageDetailExamples,
  blockageKindShortName,
  changeBlockageKind,
  chooseBlockageKind,
  chooseBlockageSubBranch,
  completeBlockageFlow,
  initialBlockageFlowState,
  subBranchChoices,
  updateBlockageDetail,
  type BlockageFlowState,
  type BlockageSelection,
  type BlockageSubBranch,
} from "./blockage-flow";

type SceneContext = {
  situation: string;
  character: string;
  goal: string;
};

export function BlockageSelectionFlow({
  videoUrl,
  scene,
  submitDisabled,
  onComplete,
}: {
  videoUrl: string;
  scene: SceneContext;
  /**
   * 마지막 버튼을 잠근다. 화면 뒤에서 도는 **다른** 일이 이 연습을 붙들고 있다는
   * 뜻이지, 이 화면이 무언가를 진행 중이라는 뜻이 아니다 — 그래서 버튼 문구는
   * 이것으로 바뀌지 않는다(무엇이 이것을 켜는지는 `use-workspace-busy.ts`).
   */
  submitDisabled: boolean;
  onComplete: (selection: BlockageSelection) => void;
}) {
  const [state, setState] = useState<BlockageFlowState>(initialBlockageFlowState);
  const [videoOpen, setVideoOpen] = useState(false);
  const chosen = state.kind !== null;

  return (
    <div className="grid gap-3">
      <div
        className={
          videoOpen
            ? "grid gap-5 sm:contents"
            : "flex min-w-0 items-center justify-between gap-3 sm:contents"
        }
      >
        <div className={videoOpen ? "sm:contents" : "order-2 min-w-0 shrink-0 sm:contents"}>
          <FoldedSceneBar
            videoUrl={videoUrl}
            scene={scene}
            open={videoOpen}
            onToggle={() => setVideoOpen((current) => !current)}
          />
        </div>
        <div className={videoOpen ? "sm:contents" : "order-1 min-w-0 flex-1 sm:contents"}>
          <QuestionStepper />
        </div>
      </div>

      {state.kind ? (
        <BackChip
          action="바꾸기"
          onClick={() => setState((current) => changeBlockageKind(current))}
          compact
        >{`고른 것 · ${blockageKindShortName(state.kind)}`}</BackChip>
      ) : null}

      {/* 화면 제목은 상태와 무관하게 하나 선다. 고른 뒤에만 서는 자리에 두면
          대분류를 고르는 순간 이 화면에서 h1 이 사라진다. */}
      <ScreenHeading
        title={chosen ? "조금만 더 알려 주세요" : "이번 연습에서 어떤 도움을 받고 싶나요?"}
        description={
          chosen
            ? "여기서 더 안 골라도 그대로 이어갈 수 있어요."
            : "고른 것에 따라 코치가 다르게 물어봐요."
        }
      />

      {chosen ? null : (
        <MainBranchPicker
          onChoose={(kind) => setState((current) => chooseBlockageKind(current, kind))}
        />
      )}

      {/* 고른 뒤에는 남은 것이 한 화면에 함께 선다 — 넘길 화면이 없으니 무엇이
          남았는지 눈으로 보이고, 하나도 더 안 골라도 그대로 이어갈 수 있다. */}
      {state.kind ? (
        <DetailPanel
          state={state}
          kind={state.kind}
          submitDisabled={submitDisabled}
          onSubBranch={(subBranch) =>
            setState((current) => chooseBlockageSubBranch(current, subBranch))
          }
          onDetail={(detail) => setState((current) => updateBlockageDetail(current, detail))}
          onComplete={() => {
            const selection = completeBlockageFlow(state);
            if (selection) onComplete(selection);
          }}
        />
      ) : null}
    </div>
  );
}

function FoldedSceneBar({
  videoUrl,
  scene,
  open,
  onToggle,
}: {
  videoUrl: string;
  scene: SceneContext;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <section
      className={
        open
          ? "overflow-hidden rounded-[28px] bg-white shadow-[0_16px_48px_rgba(25,31,40,0.08)]"
          : "overflow-visible rounded-none bg-transparent shadow-none sm:overflow-hidden sm:rounded-[28px] sm:bg-white sm:shadow-[0_16px_48px_rgba(25,31,40,0.08)]"
      }
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={
          open
            ? "flex min-h-20 w-full items-center gap-4 px-5 py-4 text-left"
            : "flex h-8 w-full items-center gap-1 px-0 py-0 text-left sm:h-auto sm:min-h-20 sm:gap-4 sm:px-5 sm:py-4"
        }
      >
        <span className={`${open ? "flex" : "hidden sm:flex"} relative h-14 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[#f7faff]`}>
          <video src={videoUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" />
          <span className="absolute flex min-h-12 min-w-12 items-center justify-center rounded-2xl bg-[#2f6bff] text-sm font-black text-white">
            ▶
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className={`${open ? "text-base" : "truncate text-xs sm:overflow-visible sm:text-clip sm:whitespace-normal sm:text-base"} block font-black text-[#191f28]`}>영상과 장면 보기</span>
          <span className={`${open ? "block" : "hidden sm:block"} mt-1 text-sm font-semibold text-[#4e5968]`}>
            영상·상황·인물·목표를 다시 볼 수 있어요
          </span>
        </span>
        <span className={`${open ? "text-sm" : "whitespace-nowrap text-xs sm:whitespace-normal sm:text-sm"} font-black text-[#4e5968]`} aria-hidden="true">
          {open ? "접기" : "펼치기"}
        </span>
      </button>
      {open ? (
        <div className="grid gap-4 px-5 pb-5">
          <video src={videoUrl} controls playsInline className="aspect-video w-full rounded-2xl object-contain" />
          <dl className="grid gap-3 rounded-2xl bg-[#f7faff] p-4 text-sm">
            {[
              ["상황", scene.situation],
              ["인물", scene.character],
              ["목표", scene.goal],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="font-black text-[#333d4b]">{label}</dt>
                <dd className="mt-1 whitespace-pre-wrap font-semibold text-[#4e5968]">
                  {value.trim() || "적지 않았어요"}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </section>
  );
}

export function QuestionStepper() {
  return (
    <>
      <div className="flex h-7 min-w-0 items-center gap-2 sm:hidden">
        <ol aria-label="연습 진행 단계" className="grid min-w-0 flex-1 grid-cols-3 gap-1">
          <li className="h-[3px] rounded-full bg-[#2f6bff]"><span className="sr-only">✓ 영상 올리기</span></li>
          <li className="h-[3px] rounded-full bg-[#2f6bff]"><span className="sr-only">✓ 장면 적기</span></li>
          <li aria-current="step" className="h-[3px] rounded-full bg-[#2f6bff]"><span className="sr-only">③ 질문 받기</span></li>
        </ol>
        <span className="shrink-0 whitespace-nowrap text-xs font-black text-[#4e5968]">
          3단계 · 질문 받기
        </span>
      </div>
      <ol aria-label="연습 진행 단계" className="hidden grid-cols-3 gap-2 text-center text-xs font-black text-[#4e5968] sm:grid">
        <li className="flex min-h-12 items-center justify-center rounded-2xl bg-white px-2">✓ 영상 올리기</li>
        <li className="flex min-h-12 items-center justify-center rounded-2xl bg-white px-2">✓ 장면 적기</li>
        <li aria-current="step" className="flex min-h-12 items-center justify-center rounded-2xl bg-[#2f6bff] px-2 text-white">
          ③ 질문 받기
        </li>
      </ol>
    </>
  );
}

/** 이 화면의 제목. 상태와 무관하게 늘 하나 서므로 h1 은 언제나 정확히 하나다. */
function ScreenHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header>
      {/* break-keep: 한글은 어절 안에서 끊으면 안 된다 — 새 제목이 좁은 화면에서 "싶/나요"로 갈렸다. */}
      <h1 className="text-2xl font-black leading-tight tracking-[-0.04em] text-[#191f28] break-keep sm:text-3xl">
        {title}
      </h1>
      <p className="mt-3 text-sm font-semibold leading-6 text-[#4e5968] sm:text-base">
        {description}
      </p>
    </header>
  );
}

/** 한 화면 안의 작은 제목. 화면 제목(h1)은 하나뿐이라 이쪽은 h2 다. */
function SectionHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header>
      <h2 className="text-lg font-black leading-tight tracking-[-0.03em] text-[#191f28] sm:text-xl">
        {title}
      </h2>
      <p className="mt-1.5 text-sm font-semibold leading-5 text-[#4e5968]">
        {description}
      </p>
    </header>
  );
}

function ChoiceCard({
  title,
  description,
  selected = false,
  compact = false,
  onClick,
}: {
  title: string;
  description: string;
  /** 고른 것을 화면에 남긴다 — 목록이 그대로 서 있어야 눌러서 바꿀 수 있다. */
  selected?: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`w-full rounded-[28px] px-6 text-left shadow-[0_16px_48px_rgba(25,31,40,0.08)] transition ${
        compact ? "min-h-[68px] py-3.5" : "min-h-24 py-5"
      } ${selected ? "bg-[#eef5ff] ring-2 ring-[#2f6bff]" : "bg-white"}`}
    >
      <span className={`block font-black text-[#191f28] ${compact ? "text-base" : "text-lg"}`}>
        {title}
      </span>
      <span className={`block text-sm font-semibold text-[#4e5968] ${compact ? "mt-1" : "mt-2"}`}>
        {description}
      </span>
    </button>
  );
}

function MainBranchPicker({ onChoose }: { onChoose: (kind: (typeof BLOCKAGE_CHOICES)[number]["value"]) => void }) {
  return (
    <section className="grid gap-4">
      <div className="grid gap-4">
        {BLOCKAGE_CHOICES.map((choice) => (
          <ChoiceCard
            key={choice.value}
            title={choice.label}
            description={choice.description}
            onClick={() => onChoose(choice.value)}
          />
        ))}
      </div>
    </section>
  );
}

function BackChip({
  children,
  action,
  onClick,
  compact = false,
}: {
  children: string;
  action: string;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 rounded-2xl bg-white px-4 text-sm shadow-[0_16px_48px_rgba(25,31,40,0.08)] ${compact ? "min-h-[44px]" : "min-h-12 py-3"}`}>
      <span className="font-black text-[#333d4b]">{children}</span>
      <button type="button" onClick={onClick} className={`${compact ? "min-h-[44px] shrink-0" : "min-h-12"} px-2 font-black text-[#2f6bff]`}>
        {action}
      </button>
    </div>
  );
}

function DetailPanel({
  state,
  kind,
  submitDisabled,
  onSubBranch,
  onDetail,
  onComplete,
}: {
  state: BlockageFlowState;
  /** 고른 대분류. 이 자리는 그것이 선 뒤에만 서므로 null 을 받지 않는다. */
  kind: NonNullable<BlockageFlowState["kind"]>;
  submitDisabled: boolean;
  onSubBranch: (subBranch: BlockageSubBranch) => void;
  onDetail: (detail: string) => void;
  onComplete: () => void;
}) {
  const [examplesOpen, setExamplesOpen] = useState(false);

  const subChoices = subBranchChoices(kind);
  // 제목·예시는 하위 갈래로 갈리지 않는다 — 갈래별 예시가 전부 막힘 서술을
  // 요구했다. 저장되는 값은 completeBlockageFlow 가 정한다.
  const examples = blockageDetailExamples();

  return (
    <section className="grid gap-3">
      {subChoices.length > 0 ? (
        <>
          <SectionHeading
            title="조금 더 좁혀 볼까요?"
            description="고르면 질문이 더 맞아떨어져요."
          />
          <div className="grid gap-2">
            {subChoices.map((choice) => (
              <ChoiceCard
                key={choice.value}
                title={choice.label}
                description={choice.description}
                selected={state.subBranch === choice.value}
                compact
                onClick={() => onSubBranch(choice.value)}
              />
            ))}
          </div>
        </>
      ) : null}

      <SectionHeading
        title={BLOCKAGE_DETAIL_TITLE}
        description="안 적어도 괜찮아요. 적으면 질문이 더 맞아떨어져요."
      />
      <div className="overflow-hidden rounded-2xl bg-[#f7faff] text-sm font-semibold text-[#4e5968]">
        <button
          type="button"
          aria-expanded={examplesOpen}
          aria-controls="blockage-detail-examples"
          onClick={() => setExamplesOpen((current) => !current)}
          className="flex min-h-[44px] w-full items-center justify-between px-4 text-left font-black text-[#4e5968]"
        >
          <span>예를 들면 —</span>
          <span aria-hidden="true">{examplesOpen ? "접기" : "펼치기"}</span>
        </button>
        {examplesOpen ? (
          <div id="blockage-detail-examples" className="grid gap-1 px-4 pb-4 leading-6">
            {examples.map((example) => <p key={example}>· {example}</p>)}
          </div>
        ) : null}
      </div>
      <div>
        <textarea
          rows={4}
          value={state.detail}
          onChange={(event) => onDetail(event.target.value)}
          placeholder="편하게 적어 주세요"
          className="h-[112px] min-h-[112px] max-h-[112px] w-full resize-none overflow-y-auto rounded-[28px] bg-white p-4 text-base font-semibold leading-6 text-[#191f28] shadow-[0_16px_48px_rgba(25,31,40,0.08)] outline-none placeholder:text-[#4e5968]"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-[#4e5968]">
            {state.detail.length}자
          </p>
          <button
            type="button"
            disabled={submitDisabled}
            onClick={onComplete}
            className="min-h-[44px] shrink-0 rounded-2xl bg-[#2f6bff] px-5 py-2 text-sm font-black text-white transition hover:bg-[#3182f6] disabled:bg-[#c9d3df]"
          >
            이대로 이어가기 →
          </button>
        </div>
      </div>
    </section>
  );
}
