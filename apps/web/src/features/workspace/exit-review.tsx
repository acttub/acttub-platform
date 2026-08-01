"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { REVIEW_FORM_URL } from "@/lib/config/env";
import { canAskAutomatically } from "./exit-review-policy";

/** 후기 창을 어디서 열었는지. 폼의 방문 기록에 그대로 실려 창구별로 나눠 볼 수 있다. */
export type ExitReviewTrigger = "x" | "leave" | "back";

const FORM_ORIGIN = new URL(REVIEW_FORM_URL).origin;

const DONE_KEY = "acttub_review_done";
const ASKED_AT_KEY = "acttub_review_asked_at";

// 인앱 브라우저처럼 저장이 막힌 환경이 있다. 못 읽고 못 써도 흐름은 그대로 간다.
function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 저장만 못 할 뿐이라 그냥 넘어간다
  }
}

/**
 * 지금 뒤로 가면 acttub를 아예 벗어나는가.
 *
 * 브라우저의 Navigation API 는 이 탭에서 우리 오리진으로 이어진 히스토리 항목만
 * 따로 세어 준다. 그중 첫 번째(index 0)에 서 있으면 뒤에 남은 acttub 화면이
 * 없다는 뜻이라, 뒤로가기는 인스타·검색처럼 밖으로 나간다.
 *
 * Link 로 미는 이동은 index 를 올리고 router.replace 는 올리지 않는다 — 그래서
 * 이동하는 지점마다 우리가 표식을 남길 필요가 없다. 화면이 새로 생겨도 저절로 맞는다.
 *
 * 이 API 가 없는 브라우저에서는 가로채지 않는다. 앱 안으로 돌아가려는 사람을
 * 붙잡는 쪽이 후기를 한 번 못 받는 것보다 나쁘다.
 */
function backLeavesSite(): boolean {
  const index = (
    window as unknown as { navigation?: { currentEntry?: { index?: number } | null } }
  ).navigation?.currentEntry?.index;
  return index === 0;
}

/**
 * 나가려는 배우에게 후기 창을 띄운다. 창구는 셋 —
 * 헤더의 마치기(직접 누름), 데스크톱에서 커서가 화면 위로 빠져나갈 때,
 * 그리고 사이트를 아예 벗어나는 뒤로가기.
 */
export function useExitReview(armed: boolean) {
  const [trigger, setTrigger] = useState<ExitReviewTrigger | null>(null);
  const askedRef = useRef(false);
  const guardPushedRef = useRef(false);

  const openFromButton = useCallback(() => setTrigger("x"), []);
  const close = useCallback(() => setTrigger(null), []);
  const markDone = useCallback(() => writeLocal(DONE_KEY, "1"), []);

  const openAutomatically = useCallback((next: ExitReviewTrigger) => {
    if (askedRef.current) return;
    askedRef.current = true;
    writeLocal(ASKED_AT_KEY, String(Date.now()));
    setTrigger((previous) => previous ?? next);
  }, []);

  useEffect(() => {
    if (!armed) return;
    if (!canAskAutomatically(readLocal(DONE_KEY), readLocal(ASKED_AT_KEY), Date.now())) {
      return;
    }

    // 데스크톱: 커서가 화면 위쪽(탭·닫기 버튼 방향)으로 빠져나가면 나가려는 것으로 본다.
    // 터치 기기에는 이런 신호가 없어 걸지 않는다.
    const pointerFine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const onMouseOut = (event: MouseEvent) => {
      if (event.relatedTarget || event.clientY > 0) return;
      openAutomatically("leave");
    };
    if (pointerFine) document.addEventListener("mouseout", onMouseOut);

    // 뒤로가기: 감시용 항목을 하나 쌓아 두고 거기서 빠져나오는 순간을 잡는다.
    // 다시 쌓지 않으므로 한 번 더 뒤로 가면 붙잡지 않고 그대로 보낸다.
    // 항목은 화면당 한 번만 쌓는다 — 새 연습을 반복하면 매번 쌓여 나갈 때
    // 뒤로가기를 여러 번 눌러야 하는 꼴이 된다.
    // 이미 쌓아 둔 항목이 있으면 그대로 듣는다. 쌓은 뒤에는 우리 항목 때문에
    // backLeavesSite() 가 false 로 보여서, 새 연습으로 넘어갈 때 감시가 끊긴다.
    const guardBack = guardPushedRef.current || backLeavesSite();
    const onPopState = () => openAutomatically("back");
    if (guardBack) {
      if (!guardPushedRef.current) {
        guardPushedRef.current = true;
        window.history.pushState({ acttubExitGuard: true }, "");
      }
      window.addEventListener("popstate", onPopState);
    }

    return () => {
      if (pointerFine) document.removeEventListener("mouseout", onMouseOut);
      if (guardBack) window.removeEventListener("popstate", onPopState);
    };
  }, [armed, openAutomatically]);

  return { trigger, openFromButton, close, markDone };
}

/** 후기 폼을 그대로 띄우는 창. 폰에서는 아래에서 올라오는 시트, 그보다 넓으면 가운데 카드. */
export function ExitReviewModal({
  trigger,
  onClose,
  onSubmitted,
}: {
  trigger: ExitReviewTrigger;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // 폼이 든 그 iframe 이 보낸 것만 받는다. 출처만 보면 같은 도메인에 있는
      // 다른 페이지가 후기를 남긴 것처럼 꾸미거나 창을 닫을 수 있다.
      if (event.origin !== FORM_ORIGIN) return;
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
      const data = event.data as { type?: string; action?: string } | null;
      if (!data || data.type !== "acttub-review") return;
      if (data.action === "submitted") onSubmitted();
      else if (data.action === "close") onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, onSubmitted]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="연습 후기"
      className="fixed inset-0 z-[70] flex items-end justify-center bg-[rgba(15,23,42,0.45)] sm:items-center sm:p-6"
    >
      <div className="flex h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-white shadow-[0_24px_60px_rgba(25,31,40,0.18)] sm:h-[86dvh] sm:max-w-[600px] sm:rounded-[28px]">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#edf0f3] px-4 sm:px-5">
          {/* 폼이 자기 제목을 가지고 있어 여기서는 무엇을 여는 창인지만 밝힌다 */}
          <p className="text-[15px] font-black tracking-[-0.03em]">연습 후기</p>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="후기 창 닫기"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[#f2f4f6] text-sm font-black text-[#4e5968] transition hover:bg-[#e5e8eb]"
          >
            ✕
          </button>
        </header>
        <iframe
          ref={frameRef}
          title="연습 후기"
          src={`${REVIEW_FORM_URL}?embed=1&src=exit-${trigger}`}
          className="min-h-0 w-full flex-1 border-0"
        />
      </div>
    </div>
  );
}
