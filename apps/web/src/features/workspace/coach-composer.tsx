"use client";

import { useRef, useState } from "react";

export function CoachComposer({
  answer, setAnswer, sending, inputEnabled, onSend,
}: {
  answer: string;
  setAnswer: (value: string) => void;
  sending: boolean;
  inputEnabled: boolean;
  onSend: () => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [asking, setAsking] = useState(false);
  const disabled = sending || !inputEnabled;
  const prepare = (text?: string) => {
    setAsking(text === undefined);
    if (text !== undefined) setAnswer(text);
    inputRef.current?.focus();
  };

  return (
    <div className="grid gap-2.5">
      <div className="relative">
        <textarea
          ref={inputRef}
          aria-label="코치에게 보낼 말"
          value={answer}
          disabled={disabled}
          maxLength={300}
          rows={3}
          placeholder={asking ? "코치에게 궁금한 점을 적어 주세요" : "답이나 질문을 편하게 적어 주세요"}
          onChange={(event) => setAnswer(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)
              && !event.nativeEvent.isComposing && answer.trim() && !disabled) {
              event.preventDefault();
              onSend();
            }
          }}
          className="h-[104px] w-full resize-none rounded-[16px] border border-[#e5e8eb] bg-[#f8fbff] px-4 pb-3 pt-8 text-base font-semibold outline-none transition placeholder:text-[#b0b8c1] focus:border-[#3182f6] focus:bg-white disabled:bg-[#f2f4f6]"
        />
        <span className="pointer-events-none absolute right-4 top-3 text-[11.5px] font-semibold tabular-nums text-[#8b95a1]">
          {answer.length} / 300
        </span>
      </div>
      <div className="flex flex-wrap gap-2 [@media(max-height:560px)]:hidden">
        <button type="button" disabled={disabled} onClick={() => prepare("예시로 설명해 주세요.")}
          className="min-h-10 flex-1 whitespace-nowrap rounded-[10px] bg-[#f2f4f6] px-3 text-xs font-black text-[#4e5968] transition hover:bg-[#eef2f6] disabled:text-[#b0b8c1]">
          예시로 설명
        </button>
        <button type="button" disabled={disabled} aria-pressed={asking} onClick={() => prepare()}
          className="min-h-10 flex-1 whitespace-nowrap rounded-[10px] bg-[#f2f4f6] px-3 text-xs font-black text-[#4e5968] transition hover:bg-[#eef2f6] disabled:text-[#b0b8c1]">
          코치에게 질문
        </button>
        <button type="button" disabled={disabled}
          onClick={() => prepare("지금은 연습하기 어려워요. 다음에 해볼 방법을 설명해 주세요.")}
          className="min-h-10 flex-1 whitespace-nowrap rounded-[10px] bg-[#f2f4f6] px-3 text-xs font-black text-[#4e5968] transition hover:bg-[#eef2f6] disabled:text-[#b0b8c1]">
          나중에 연습
        </button>
      </div>
      <button type="button" onClick={onSend} disabled={disabled || !answer.trim()}
        className="min-h-12 w-full rounded-[16px] bg-[#3182f6] px-6 py-3 text-sm font-black text-white transition hover:bg-[#1b64da] disabled:bg-[#c9d3df]">
        {sending ? "코치가 생각하고 있어요" : "보내기 →"}
      </button>
      <p className="text-xs font-semibold text-[#8b95a1] [@media(max-height:560px)]:hidden">
        &apos;그만&apos;이라고 쓰면 언제든 마칠 수 있어요
      </p>
    </div>
  );
}
