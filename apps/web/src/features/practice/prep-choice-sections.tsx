"use client";

import {
  DIFFICULTY_CHOICES,
  PURPOSE_CHOICES,
  toggleDifficultyChoice,
  togglePurposeChoice,
  type DifficultyChoiceId,
  type PurposeChoiceId,
} from "./prep-choices";

/** M4 레퍼런스의 플랫 섹션 — 카드 없이 제목·안내·칩 한 벌. */
export function PrepQuestionSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-3">
      <header>
        <h2 className="text-[15px] font-black leading-tight tracking-[-0.01em] text-[#191f28] sm:text-base">
          {title}
        </h2>
        <p className="mt-1 text-xs font-semibold leading-[18px] text-[#6b7684]">
          {description}
        </p>
      </header>
      {children}
    </section>
  );
}

function ChoiceChip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`min-h-10 flex-1 whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-bold transition ${
        selected ? "bg-[#e8f3ff] text-[#3182f6]" : "bg-[#f2f4f6] text-[#4e5968]"
      }`}
    >
      {label}
    </button>
  );
}

export function PurposeFields({
  selected,
  onChange,
}: {
  selected: PurposeChoiceId | null;
  onChange: (next: PurposeChoiceId | null) => void;
}) {
  return (
    <PrepQuestionSection
      title="어떤 연습에서 이 장면을 찍고 있나요?"
      description="가장 가까운 하나를 골라 주세요."
    >
      <div className="flex flex-wrap gap-2">
        {PURPOSE_CHOICES.map((choice) => (
          <ChoiceChip
            key={choice.id}
            label={choice.label}
            selected={selected === choice.id}
            onClick={() => onChange(togglePurposeChoice(selected, choice.id))}
          />
        ))}
      </div>
    </PrepQuestionSection>
  );
}

export function DifficultyFields({
  selected,
  onChange,
}: {
  selected: DifficultyChoiceId | null;
  onChange: (next: DifficultyChoiceId | null) => void;
}) {
  return (
    <PrepQuestionSection
      title="어떤 어려움이 가장 크게 느껴졌나요?"
      description="고르기 어렵다면 떠오르는 것부터 선택하세요."
    >
      <div className="flex flex-wrap gap-2">
        {DIFFICULTY_CHOICES.map((choice) => (
          <ChoiceChip
            key={choice.id}
            label={choice.label}
            selected={selected === choice.id}
            onClick={() => onChange(toggleDifficultyChoice(selected, choice.id))}
          />
        ))}
      </div>
    </PrepQuestionSection>
  );
}
