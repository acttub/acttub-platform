"use client";

import {
  BLOCKAGE_CHOICES,
  chooseBlockageKind,
  updateBlockageDetail,
  type BlockageFlowState,
} from "./blockage-flow";

/**
 * 준비 화면이 드는 상태를 그대로 편집한다. 시작 버튼은 이 상태를 읽어 요청을 만든다.
 * 하위 갈래 선택은 2026-09-01 걷어냈다 — 대분류와 상세 서술 칸 하나만 남기고,
 * sub_branch 는 기본값 "그 외"로 간다.
 */
export function BlockageFields({
  state,
  onChange,
}: {
  state: BlockageFlowState;
  onChange: (state: BlockageFlowState) => void;
}) {
  const selectedChoice = BLOCKAGE_CHOICES.find((choice) => choice.value === state.kind);

  return (
    <section className="grid gap-3">
      <SectionHeading
        title="이번 연습에서 어떤 도움을 받고 싶나요?"
        description="고르지 않아도 영상에서 보이는 것부터 같이 찾아요."
      />
      <div className="flex flex-wrap gap-2">
        {BLOCKAGE_CHOICES.map((choice) => (
          <ChoiceChip
            key={choice.value}
            label={choice.label}
            selected={state.kind === choice.value}
            onClick={() => onChange(chooseBlockageKind(state, choice.value))}
          />
        ))}
      </div>
      {selectedChoice ? (
        <p className="text-xs font-semibold leading-[18px] text-[#4e5968]">
          {selectedChoice.description}
        </p>
      ) : null}

      <SectionHeading
        title="상세히 적어 주세요"
        description="안 적어도 괜찮아요. 적으면 질문이 더 맞아떨어져요."
      />
      <textarea
        rows={4}
        value={state.detail}
        onChange={(event) => onChange(updateBlockageDetail(state, event.target.value))}
        placeholder="편하게 적어 주세요"
        className="min-h-[104px] w-full resize-none rounded-xl border border-[#e5e8eb] bg-[#f8fafc] p-3.5 text-sm font-semibold leading-6 text-[#191f28] outline-none transition placeholder:text-[13px] placeholder:text-[#b0b8c1] focus:border-[#3182f6] focus:bg-white focus:ring-4 focus:ring-[#e8f3ff]"
      />
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
      <h2 className="text-[15px] font-black leading-tight tracking-[-0.01em] text-[#191f28] sm:text-base">
        {title}
      </h2>
      <p className="mt-1 text-xs font-semibold leading-[18px] text-[#6b7684]">
        {description}
      </p>
    </header>
  );
}

function ChoiceChip({
  label,
  selected = false,
  onClick,
}: {
  label: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`min-h-10 flex-1 whitespace-nowrap rounded-full px-4 py-2 text-[12.5px] font-bold transition ${
        selected
          ? "bg-[#e8f3ff] text-[#3182f6]"
          : "bg-[#f2f4f6] text-[#4e5968]"
      }`}
    >
      {label}
    </button>
  );
}
