"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  trackExitReviewOpened,
  trackExitReviewSubmitted,
} from "@/lib/analytics/amplitude";
import { claimExitSurvey, submitPracticeFeedback } from "@/lib/api/v2/practice-feedback";
import type { FeedbackScreen } from "@/lib/practice/api-types";
import { newRequestId } from "@/lib/reading/request-id";
import {
  FEEDBACK_BODY_MAX,
  FEEDBACK_CONTACT_MAX,
  PRIVACY_NOTICE,
  validateFeedback,
} from "./exit-survey";

/** 후기 창을 어디서 열었는지. 접수 행에 그대로 실려 창구별로 나눠 볼 수 있다. */
export type ExitReviewTrigger = "x" | "leave" | "back";

/**
 * 나가려는 배우에게 후기 시트를 띄운다. 창구는 셋 —
 * 헤더의 마치기(직접 누름), 데스크톱에서 커서가 화면 위로 빠져나갈 때,
 * 그리고 사이트를 아예 벗어나는 뒤로가기.
 *
 * 1.0.0 부터 "한 번만 묻기"는 서버가 정한다. 자동 노출 직전에 계정의 노출 표식을 선점하고,
 * 선점한 기기만 띄운다 — 기기마다 따로 세던 옛 규칙(7일 뒤 다시)은 없앴다. 마치기 버튼은
 * 배우가 직접 누른 것이라 선점을 타지 않는다.
 */
export function useExitReview(armed: boolean, mode: "chat" | "note") {
  const [trigger, setTrigger] = useState<ExitReviewTrigger | null>(null);
  const askedRef = useRef(false);
  const guardPushedRef = useRef(false);

  const openFromButton = useCallback(() => {
    trackExitReviewOpened("x", mode);
    setTrigger("x");
  }, [mode]);
  const close = useCallback(() => setTrigger(null), []);

  const openAutomatically = useCallback((next: ExitReviewTrigger) => {
    if (askedRef.current) return;
    askedRef.current = true;
    // 오프라인에서는 새 자동 노출을 하지 않는다 — 선점도 접수도 못 하는 채로 물으면
    // 배우가 쓴 소감이 갈 곳이 없다.
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    void claimExitSurvey().then((claimed) => {
      if (!claimed) return;
      trackExitReviewOpened(next, mode);
      setTrigger((previous) => previous ?? next);
    });
  }, [mode]);

  useEffect(() => {
    if (!armed) return;

    // 데스크톱: 커서가 화면 위쪽(탭·닫기 버튼 방향)으로 빠져나가면 나가려는 것으로 본다.
    // 터치 기기에는 이런 신호가 없어 걸지 않는다.
    const pointerFine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const onMouseOut = (event: MouseEvent) => {
      if (event.relatedTarget || event.clientY > 0) return;
      openAutomatically("leave");
    };
    if (pointerFine) document.addEventListener("mouseout", onMouseOut);

    // 뒤로가기: 이 화면을 떠나는 뒤로가기를 잡는다 — 밖으로 나가든 랜딩으로
    // 돌아가든, 연습 화면에서 뒤로 가는 건 대개 "그만하겠다"다.
    // 감시용 항목을 하나 쌓아 두고 거기서 빠져나오는 순간을 잡되, 다시 쌓지는
    // 않는다. 그래서 창을 닫고 한 번 더 뒤로 가면 붙잡지 않고 그대로 보낸다.
    // 항목은 화면당 한 번만 쌓는다 — 새 연습을 반복할 때마다 쌓으면 나갈 때
    // 뒤로가기를 여러 번 눌러야 하는 꼴이 된다.
    const onPopState = () => openAutomatically("back");
    if (!guardPushedRef.current) {
      guardPushedRef.current = true;
      window.history.pushState({ acttubExitGuard: true }, "");
    }
    window.addEventListener("popstate", onPopState);

    return () => {
      if (pointerFine) document.removeEventListener("mouseout", onMouseOut);
      window.removeEventListener("popstate", onPopState);
    };
  }, [armed, openAutomatically]);

  return { trigger, openFromButton, close };
}

/**
 * 후기 시트. 외부 폼을 띄우던 자리를 대신한다 — 소감은 서버에 먼저 저장되고 시트 복제는
 * 서버가 맡는다.
 *
 * 나가는 길을 막지 않는 것이 이 창의 첫 규칙이다. 보내기가 실패해도 창은 닫히고, 건너뛰기도
 * 본문 없는 행(dismissed)으로 남긴 뒤 닫는다. 그 전송이 실패해도 마찬가지다.
 */
export function ExitReviewModal({
  trigger,
  screen,
  practiceId,
  onClose,
}: {
  trigger: ExitReviewTrigger;
  screen: FeedbackScreen;
  practiceId: string | null;
  onClose: () => void;
}) {
  const [body, setBody] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  // 한 창에 한 요청 id — 보내기가 늦게 도착해 다시 눌러도 행은 하나다.
  const requestIdRef = useRef<string | null>(null);
  if (requestIdRef.current === null) requestIdRef.current = newRequestId();
  // 보내기와 건너뛰기가 둘 다 가지 않게 한다.
  const settledRef = useRef(false);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const finish = useCallback(
    async (payload?: { body: string; contact_email?: string; contact_phone?: string }) => {
      if (settledRef.current) return;
      settledRef.current = true;
      try {
        await submitPracticeFeedback(
          { practiceId, screen, trigger, ...(payload ?? {}) },
          { requestId: requestIdRef.current as string },
        );
        if (payload) trackExitReviewSubmitted(trigger);
      } catch {
        // 접수가 실패해도 나가기를 막지 않는다. 다시 묻지도 않는다 — 선점은 이미 끝났다.
      } finally {
        onClose();
      }
    },
    [onClose, practiceId, screen, trigger],
  );

  const send = useCallback(() => {
    const checked = validateFeedback({ body, email, phone });
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    setError(null);
    setSending(true);
    void finish(checked.payload);
  }, [body, email, phone, finish]);

  const skip = useCallback(() => void finish(), [finish]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") skip();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [skip]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="연습 후기"
      className="fixed inset-0 z-[70] flex items-end justify-center bg-[rgba(15,23,42,0.45)] sm:items-center sm:p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) skip();
      }}
    >
      <div className="flex w-full flex-col gap-4 rounded-t-[28px] bg-white p-5 shadow-[0_24px_60px_rgba(25,31,40,0.18)] sm:max-w-[520px] sm:rounded-[28px] sm:p-6">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[17px] font-black tracking-[-0.03em] text-[#191f28]">오늘 연습 어땠나요?</p>
            <p className="mt-1 text-xs font-semibold leading-5 text-[#8b95a1]">{PRIVACY_NOTICE}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={skip}
            aria-label="후기 창 닫기"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[#f2f4f6] text-sm font-black text-[#4e5968] transition hover:bg-[#e5e8eb]"
          >
            ✕
          </button>
        </header>

        <label className="grid gap-1.5">
          <span className="sr-only">한 줄 소감</span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={FEEDBACK_BODY_MAX}
            rows={3}
            placeholder="한 줄만 적어 주세요"
            className="w-full resize-none rounded-xl border border-[#e5e8eb] bg-[#f8fafc] p-3.5 text-sm font-semibold leading-6 text-[#191f28] outline-none transition placeholder:text-[#b0b8c1] focus:border-[#3182f6] focus:bg-white"
          />
        </label>

        {/* 연락처는 선택이다. 답을 듣고 싶은 사람만 적는다. */}
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={FEEDBACK_CONTACT_MAX}
            placeholder="이메일(선택)"
            aria-label="이메일(선택)"
            className="h-11 rounded-xl border border-[#e5e8eb] bg-[#f8fafc] px-3.5 text-sm font-semibold text-[#191f28] outline-none transition placeholder:text-[#b0b8c1] focus:border-[#3182f6] focus:bg-white"
          />
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            maxLength={FEEDBACK_CONTACT_MAX}
            placeholder="전화번호(선택)"
            aria-label="전화번호(선택)"
            className="h-11 rounded-xl border border-[#e5e8eb] bg-[#f8fafc] px-3.5 text-sm font-semibold text-[#191f28] outline-none transition placeholder:text-[#b0b8c1] focus:border-[#3182f6] focus:bg-white"
          />
        </div>

        {error ? (
          <p role="alert" className="text-xs font-bold text-[#e03131]">
            {error}
          </p>
        ) : null}

        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={skip}
            className="h-12 flex-1 rounded-[14px] bg-[#f8fbff] text-sm font-black text-[#4e5968] transition hover:bg-[#eef2f6]"
          >
            건너뛰기
          </button>
          <button
            type="button"
            disabled={sending}
            onClick={send}
            className="h-12 flex-1 rounded-[14px] bg-[#3182f6] text-sm font-black text-white transition hover:bg-[#1b64da] disabled:bg-[#c9d3df]"
          >
            {sending ? "보내는 중…" : "보내기"}
          </button>
        </div>
      </div>
    </div>
  );
}
