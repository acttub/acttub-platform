"use client";

import { useEffect, useRef, useState } from "react";
import { DISPLAY_NAME_MAX_LENGTH, normalizeDisplayName } from "./display-name";

// 첫 가입 직후 한 번 뜨는 호칭 입력 팝업.
export function NamePrompt({
  onSubmit,
  onSkip,
}: {
  onSubmit: (name: string) => void;
  onSkip: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const name = normalizeDisplayName(value);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="name-prompt-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.45)] p-5"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name) onSubmit(name);
        }}
        className="w-full max-w-md rounded-[28px] bg-white p-6 shadow-[0_24px_60px_rgba(25,31,40,0.18)] sm:p-7"
      >
        <h2 id="name-prompt-title" className="text-xl font-black tracking-[-0.04em]">
          어떻게 불러드릴까요?
        </h2>
        <p className="mt-3 font-semibold leading-7 text-[#6b7684]">
          연습 화면에서 이 이름으로 불러드려요. 본명이 아니어도 괜찮아요.
        </p>

        <label className="mt-6 block">
          <span className="text-sm font-black text-[#333d4b]">이름</span>
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            placeholder="예: 지원"
            autoComplete="nickname"
            className="mt-2 h-12 w-full rounded-2xl border border-[#e5e8eb] bg-white px-4 text-base font-bold outline-none transition placeholder:text-[#b0b8c1] focus:border-[#3182f6] focus:ring-4 focus:ring-[#e8f3ff]"
          />
        </label>

        <button
          type="submit"
          disabled={!name}
          className="mt-6 h-12 w-full rounded-2xl bg-[#3182f6] text-base font-black text-white transition hover:bg-[#1b64da] disabled:bg-[#c9d3df]"
        >
          시작하기
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="mt-2 h-12 w-full rounded-2xl text-sm font-bold text-[#8b95a1] transition hover:bg-[#f7f8fa] hover:text-[#4e5968]"
        >
          나중에 정할게요
        </button>
      </form>
    </div>
  );
}
