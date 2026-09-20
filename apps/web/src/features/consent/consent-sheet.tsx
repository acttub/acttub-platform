"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { analyticsConsentGate } from "@/features/analytics/analytics";
import { ConsentMarkdown } from "@/features/practice/consent-markdown";
import { trackConsentSubmitted } from "@/lib/analytics/amplitude";
import {
  registerConsentPrompt,
  type ConsentPromptResult,
} from "@/lib/api/v2/consent-prompt";
import type { ConsentDocument } from "@/lib/api/v2/types";

import {
  canAgree,
  openSheet,
  submitSheet,
  type ConsentSheet as Sheet,
} from "./consent-sheet-flow";
import { GUEST_BROWSER_ONLY_NOTICE } from "./guest-notice";

type OpenSheet = {
  sheet: Sheet;
  resolve: (result: ConsentPromptResult) => void;
};

/**
 * 루트 레이아웃에 한 번 놓는다. 평소에는 아무것도 그리지 않고, 공용 클라이언트가 403
 * consent_required 를 받았을 때만 빠진 문서로 시트를 띄운다. 결정이 끝나면 클라이언트가
 * 막혔던 요청을 다시 보낸다(account.guest).
 *
 * 동의 문서 공개 페이지(/terms)와는 다른 것이다 — 그쪽은 언제나 열람용이고 결정은
 * 여기서만 받는다.
 */
export function ConsentSheetHost() {
  const [open, setOpen] = useState<OpenSheet | null>(null);

  useEffect(
    () =>
      registerConsentPrompt(
        (documents) =>
          new Promise<ConsentPromptResult>((resolve) => {
            // 서버가 동의가 빠졌다고 알려 왔다. 제출을 기다리지 않고 계측부터 끈다(결정 I-6).
            analyticsConsentGate.suspend();
            const sheet = openSheet(documents);
            if (sheet.documents.length === 0) {
              void analyticsConsentGate.check();
              resolve("dismissed");
              return;
            }
            setOpen({ sheet, resolve });
          }),
      ),
    [],
  );

  const close = useCallback(
    (result: ConsentPromptResult) => {
      // 닫기만 했어도 다시 묻는다. 빠진 것이 privacy 가 아니었다면(예: AI 분석 동의만)
      // 서버의 답은 여전히 granted 다. 동의한 경우는 제출 직후에 이미 물었다.
      if (result === "dismissed") void analyticsConsentGate.check();
      open?.resolve(result);
      setOpen(null);
    },
    [open],
  );

  if (!open) return null;
  // 새 판 때문에 시트가 이어서 다시 뜨면 앞 시트의 체크를 물려받지 않게 한다.
  const sheetKey = open.sheet.documents.map((document) => document.id).join(",");
  return <ConsentSheetDialog key={sheetKey} sheet={open.sheet} onClose={close} />;
}

function ConsentSheetDialog({
  sheet,
  onClose,
}: {
  sheet: Sheet;
  onClose: (result: ConsentPromptResult) => void;
}) {
  const [ageChecked, setAgeChecked] = useState(false);
  const [askAge, setAskAge] = useState(sheet.askAge);
  const [viewing, setViewing] = useState<ConsentDocument | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // 시트와 그 위의 전문이 떠 있는 동안 뒤 화면은 스크롤되지 않는다.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || submitting) return;
      if (viewing) setViewing(null);
      else onClose("dismissed");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, submitting, viewing]);

  async function agree() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitSheet({ ...sheet, askAge }, ageChecked);
      if (result.kind === "decided") {
        // 동의 제출 직후 서버에 다시 묻는다. 켜졌다면 그 뒤의 첫 이벤트가 이것이다.
        await analyticsConsentGate.check();
        trackConsentSubmitted("ok");
        onClose("decided");
        return;
      }
      if (result.kind === "age_required") {
        setAskAge(true);
        setAgeChecked(false);
        setError("만 14세 이상인지 확인해 주세요.");
        return;
      }
      trackConsentSubmitted("partial_fail");
      setError(result.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-sheet-title"
      className="fixed inset-0 z-[80] flex items-end justify-center bg-[rgba(15,23,42,0.45)] sm:items-center sm:p-6"
    >
      <div className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-white text-[#191f28] shadow-[0_24px_60px_rgba(25,31,40,0.18)] sm:max-w-[480px] sm:rounded-[28px]">
        <header className="flex shrink-0 items-start justify-between gap-3 px-5 pt-6 sm:px-6">
          <div className="min-w-0">
            <h2
              id="consent-sheet-title"
              className="text-[19px] font-black tracking-[-0.03em]"
            >
              계속하려면 동의가 필요해요
            </h2>
            <p className="mt-1.5 text-sm font-semibold leading-6 text-[#6b7684]">
              이 기능에 필요한 문서만 확인해요.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            disabled={submitting}
            onClick={() => onClose("dismissed")}
            aria-label="동의 창 닫기"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[#f2f4f6] text-sm font-black text-[#4e5968] transition hover:bg-[#e5e8eb] disabled:opacity-60"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-2 pt-4 sm:px-6">
          <ul className="divide-y divide-[#f2f4f6] rounded-2xl border border-[#e5e8eb]">
            {sheet.documents.map((document) => (
              <li
                key={document.id}
                className="flex items-center justify-between gap-3 px-4 py-3.5"
              >
                <span className="min-w-0 text-sm font-bold leading-5">
                  <span className="mr-1.5 text-[#3182f6]">필수</span>
                  {document.title}
                </span>
                <button
                  type="button"
                  onClick={() => setViewing(document)}
                  className="shrink-0 text-sm font-semibold text-[#8b95a1] underline underline-offset-2 transition hover:text-[#4e5968]"
                >
                  보기
                </button>
              </li>
            ))}
          </ul>

          {askAge ? (
            <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-2xl border border-[#e5e8eb] px-4 py-3.5 text-sm font-bold has-[:checked]:border-[#3182f6] has-[:checked]:bg-[#f2f7ff]">
              <input
                type="checkbox"
                checked={ageChecked}
                disabled={submitting}
                onChange={(event) => {
                  setAgeChecked(event.target.checked);
                  setError(null);
                }}
                className="h-5 w-5 shrink-0 accent-[#3182f6]"
              />
              <span>만 14세 이상이에요</span>
            </label>
          ) : null}

          {sheet.askAge ? (
            <p className="mt-3 rounded-2xl bg-[#f2f4f6] px-4 py-3 text-[13px] font-semibold leading-5 text-[#4e5968]">
              {GUEST_BROWSER_ONLY_NOTICE}
            </p>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="mt-3 rounded-2xl bg-[#fff4f4] px-4 py-3 text-sm leading-6 text-[#d92d20]"
            >
              {error}
            </p>
          ) : null}
        </div>

        <div className="shrink-0 px-5 pb-6 pt-3 sm:px-6">
          <button
            type="button"
            disabled={!canAgree({ ...sheet, askAge }, ageChecked) || submitting}
            onClick={() => void agree()}
            className="h-14 w-full rounded-2xl bg-[#3182f6] px-5 text-base font-semibold text-white transition hover:bg-[#1b64da] disabled:cursor-not-allowed disabled:bg-[#b0d2ff]"
          >
            {submitting ? "동의 내용을 저장하고 있어요" : "동의하고 계속하기"}
          </button>
        </div>

        {viewing ? (
          <ConsentDocumentViewer
            document={viewing}
            onClose={() => setViewing(null)}
          />
        ) : null}
      </div>
    </div>
  );
}

/** 전문은 시트 위에 띄운다. 시트는 제목과 "보기"만 둔다(account.guest). */
function ConsentDocumentViewer({
  document,
  onClose,
}: {
  document: ConsentDocument;
  onClose: () => void;
}) {
  return (
    <section
      aria-label={document.title}
      className="absolute inset-0 z-10 flex flex-col bg-white"
    >
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[#edf0f3] px-5 sm:px-6">
        <h3 className="min-w-0 truncate text-[15px] font-black tracking-[-0.03em]">
          {document.title}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-sm font-bold text-[#3182f6]"
        >
          닫기
        </button>
      </header>
      <div
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 outline-none sm:px-6"
      >
        <ConsentMarkdown source={document.body} />
      </div>
    </section>
  );
}
