"use client";

import { useState } from "react";
import {
  BLOCKAGE_CHOICES,
  blockageDetailExamples,
  blockageDetailTitle,
  changeBlockageKind,
  changeBlockageSubBranch,
  chooseBlockageKind,
  chooseBlockageSubBranch,
  completeBlockageFlow,
  initialBlockageFlowState,
  subBranchChoices,
  updateBlockageDetail,
  type BlockageFlowState,
  type BlockageSelection,
} from "./blockage-flow";

type SceneContext = {
  situation: string;
  character: string;
  goal: string;
};

export function BlockageSelectionFlow({
  videoUrl,
  scene,
  busy,
  onComplete,
}: {
  videoUrl: string;
  scene: SceneContext;
  busy: boolean;
  onComplete: (selection: BlockageSelection) => void;
}) {
  const [state, setState] = useState<BlockageFlowState>(initialBlockageFlowState);
  const [videoOpen, setVideoOpen] = useState(false);
  const detailStep = state.step === "detail";

  return (
    <div className={detailStep ? "grid gap-3" : "grid gap-5"}>
      {!detailStep ? (
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
      ) : null}
      {detailStep ? <QuestionStepper /> : null}

      {state.step === "main" ? (
        <MainBranchScreen onChoose={(kind) => setState((current) => chooseBlockageKind(current, kind))} />
      ) : null}

      {state.step === "sub" && state.kind ? (
        <SubBranchScreen
          state={state}
          onChangeKind={() => setState((current) => changeBlockageKind(current))}
          onChoose={(subBranch) =>
            setState((current) => chooseBlockageSubBranch(current, subBranch))
          }
        />
      ) : null}

      {state.step === "detail" && state.kind && state.subBranch ? (
        <DetailScreen
          state={state}
          busy={busy}
          onBack={() => setState((current) => changeBlockageSubBranch(current))}
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

function ScreenHeading({
  title,
  description,
  compact = false,
}: {
  title: string;
  description: string;
  compact?: boolean;
}) {
  return (
    <header>
      <h1 className={`${compact ? "text-xl sm:text-2xl" : "text-2xl sm:text-3xl"} font-black leading-tight tracking-[-0.04em] text-[#191f28]`}>
        {title}
      </h1>
      <p className={`${compact ? "mt-1.5 leading-5" : "mt-3 leading-6"} text-sm font-semibold text-[#4e5968] sm:text-base`}>
        {description}
      </p>
    </header>
  );
}

function ChoiceCard({
  title,
  description,
  onClick,
}: {
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-24 w-full rounded-[28px] bg-white px-6 py-5 text-left shadow-[0_16px_48px_rgba(25,31,40,0.08)] transition"
    >
      <span className="block text-lg font-black text-[#191f28]">{title}</span>
      <span className="mt-2 block text-sm font-semibold text-[#4e5968]">{description}</span>
    </button>
  );
}

function MainBranchScreen({ onChoose }: { onChoose: (kind: (typeof BLOCKAGE_CHOICES)[number]["value"]) => void }) {
  return (
    <section className="grid gap-5">
      <ScreenHeading
        title="지금 연기에서 어느 쪽이 더 막히나요?"
        description="고른 쪽에 맞춰 질문을 준비할게요. 하나만 골라 주세요."
      />
      <div className="grid gap-4">
        {BLOCKAGE_CHOICES.map((choice) => (
          <ChoiceCard
            key={choice.value}
            title={choice.value}
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

function SubBranchScreen({
  state,
  onChangeKind,
  onChoose,
}: {
  state: BlockageFlowState;
  onChangeKind: () => void;
  onChoose: (subBranch: NonNullable<BlockageFlowState["subBranch"]>) => void;
}) {
  if (!state.kind) return null;
  return (
    <section className="grid gap-5">
      <BackChip action="바꾸기" onClick={onChangeKind}>{`앞에서 고른 것 · ${state.kind}`}</BackChip>
      <ScreenHeading
        title={`${state.kind} 중에서도 어디가 가장 막히나요?`}
        description={`'${state.kind}'을 조금 더 좁혀 볼게요. 하나만 골라 주세요.`}
      />
      <div className="grid gap-4">
        {subBranchChoices(state.kind).map((choice) => (
          <ChoiceCard
            key={choice.value}
            title={choice.value}
            description={choice.description}
            onClick={() => onChoose(choice.value)}
          />
        ))}
      </div>
    </section>
  );
}

function DetailScreen({
  state,
  busy,
  onBack,
  onDetail,
  onComplete,
}: {
  state: BlockageFlowState;
  busy: boolean;
  onBack: () => void;
  onDetail: (detail: string) => void;
  onComplete: () => void;
}) {
  const [examplesOpen, setExamplesOpen] = useState(false);

  if (!state.kind || !state.subBranch) return null;
  const examples = blockageDetailExamples(state.subBranch);
  const selected = state.kind === "그 외" ? state.kind : `${state.kind} · ${state.subBranch}`;
  const action = state.kind === "그 외" ? "앞 선택 바꾸기" : `${state.subBranch} 바꾸기`;

  return (
    <section className="grid gap-3">
      <BackChip action={action} onClick={onBack} compact>{`고른 것 · ${selected}`}</BackChip>
      <ScreenHeading
        title={blockageDetailTitle(state.subBranch)}
        description="어디에서 막히는지 적으면 질문이 더 정확해져요. 비워 두어도 괜찮아요."
        compact
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
          placeholder="막힌 순간을 편하게 적어 주세요"
          className="h-[112px] min-h-[112px] max-h-[112px] w-full resize-none overflow-y-auto rounded-[28px] bg-white p-4 text-base font-semibold leading-6 text-[#191f28] shadow-[0_16px_48px_rgba(25,31,40,0.08)] outline-none placeholder:text-[#4e5968]"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-[#4e5968]">
            {state.detail.length}자
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={onComplete}
            className="min-h-[44px] shrink-0 rounded-2xl bg-[#2f6bff] px-5 py-2 text-sm font-black text-white transition hover:bg-[#3182f6]"
          >
            {busy ? "이어가는 중…" : "이대로 이어가기 →"}
          </button>
        </div>
      </div>
    </section>
  );
}
