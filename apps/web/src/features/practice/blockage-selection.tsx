"use client";

import { useState } from "react";
import {
  BLOCKAGE_CHOICES,
  BLOCKAGE_DETAIL_TITLE,
  blockageDetailExamples,
  chooseBlockageKind,
  chooseBlockageSubBranch,
  subBranchChoices,
  updateBlockageDetail,
  type BlockageFlowState,
  type BlockageSubBranch,
} from "./blockage-flow";

/** 준비 화면이 드는 상태를 그대로 편집한다. 시작 버튼은 이 상태를 읽어 요청을 만든다. */
export function BlockageFields({
  state,
  onChange,
}: {
  state: BlockageFlowState;
  onChange: (state: BlockageFlowState) => void;
}) {
  return (
    <section className="grid gap-4">
      <SectionHeading
        title="이번 연습에서 어떤 도움을 받고 싶나요?"
        description="고르지 않아도 영상에서 보이는 것부터 같이 찾아요."
      />
      <MainBranchPicker
        selected={state.kind}
        onChoose={(kind) => onChange(chooseBlockageKind(state, kind))}
      />
      {state.kind ? (
        <DetailPanel
          state={state}
          kind={state.kind}
          onSubBranch={(subBranch) =>
            onChange(chooseBlockageSubBranch(state, subBranch))
          }
          onDetail={(detail) => onChange(updateBlockageDetail(state, detail))}
        />
      ) : null}
    </section>
  );
}

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
  onClick,
}: {
  title: string;
  description: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`min-h-[68px] w-full rounded-[28px] px-6 py-3.5 text-left shadow-[0_16px_48px_rgba(25,31,40,0.08)] transition ${
        selected ? "bg-[#eef5ff] ring-2 ring-[#2f6bff]" : "bg-white"
      }`}
    >
      <span className="block text-base font-black text-[#191f28]">{title}</span>
      <span className="mt-1 block text-sm font-semibold text-[#4e5968]">
        {description}
      </span>
    </button>
  );
}

function MainBranchPicker({
  selected,
  onChoose,
}: {
  selected: BlockageFlowState["kind"];
  onChoose: (kind: (typeof BLOCKAGE_CHOICES)[number]["value"]) => void;
}) {
  return (
    <div className="grid gap-2">
      {BLOCKAGE_CHOICES.map((choice) => (
        <ChoiceCard
          key={choice.value}
          title={choice.label}
          description={choice.description}
          selected={selected === choice.value}
          onClick={() => onChoose(choice.value)}
        />
      ))}
    </div>
  );
}

function DetailPanel({
  state,
  kind,
  onSubBranch,
  onDetail,
}: {
  state: BlockageFlowState;
  kind: NonNullable<BlockageFlowState["kind"]>;
  onSubBranch: (subBranch: BlockageSubBranch) => void;
  onDetail: (detail: string) => void;
}) {
  const [examplesOpen, setExamplesOpen] = useState(false);
  const subChoices = subBranchChoices(kind);
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
        <p className="mt-2 text-sm font-semibold text-[#4e5968]">
          {state.detail.length}자
        </p>
      </div>
    </section>
  );
}
