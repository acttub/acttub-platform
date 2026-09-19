"use client";

import { useEffect, useRef } from "react";

import { GUEST_TRANSFERRED_MESSAGE } from "@/lib/api/v2/errors";

import { useGuestTransferred } from "./use-guest-transferred";

/**
 * 루트 레이아웃에 한 번 놓는다. 평소에는 아무것도 그리지 않고, 이 브라우저의 게스트가 앱으로
 * 옮겨졌다는 답을 받았을 때만 "옮겼어요" 안내와 새로 시작 버튼을 띄운다(account.guest).
 *
 * 닫기 버튼이 없다 — 뒤 화면은 옮겨진 게스트의 연습이고, 그 토큰으로는 더 이상 아무것도
 * 할 수 없다. 나가는 길은 새로 시작 하나다.
 */
export function TransferredNoticeHost() {
  const { transferred, startOver } = useGuestTransferred();
  if (!transferred) return null;
  return <TransferredNotice onStartOver={startOver} />;
}

function TransferredNotice({ onStartOver }: { onStartOver: () => void }) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="transferred-notice-title"
      aria-describedby="transferred-notice-body"
      className="fixed inset-0 z-[90] flex items-end justify-center bg-[rgba(15,23,42,0.45)] sm:items-center sm:p-6"
    >
      <div className="w-full rounded-t-[28px] bg-white px-5 pb-6 pt-7 text-[#191f28] shadow-[0_24px_60px_rgba(25,31,40,0.18)] sm:max-w-[440px] sm:rounded-[28px] sm:px-6">
        <h2
          id="transferred-notice-title"
          className="text-[22px] font-black tracking-[-0.03em]"
        >
          옮겼어요
        </h2>
        <p
          id="transferred-notice-body"
          className="mt-2.5 text-[15px] font-semibold leading-7 text-[#4e5968]"
        >
          {GUEST_TRANSFERRED_MESSAGE}
        </p>
        <button
          ref={buttonRef}
          type="button"
          onClick={onStartOver}
          className="mt-6 h-14 w-full rounded-2xl bg-[#3182f6] px-5 text-base font-semibold text-white transition hover:bg-[#1b64da]"
        >
          새로 시작
        </button>
      </div>
    </div>
  );
}
