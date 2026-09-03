"use client";

/**
 * 루트 레이아웃까지 깨졌을 때 뜨는 마지막 화면. 여기까지 오면 `layout.tsx`가 렌더되지
 * 않으므로 `<html>`·`<body>`를 직접 그려야 한다.
 *
 * Sentry에 직접 보내는 이유는 이 경계에서 잡힌 에러가 자동으로는 올라가지 않기
 * 때문이다. React가 이미 처리한 것으로 보아 다시 던지지 않는다.
 */
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { PretendardStylesheet } from "./pretendard-stylesheet";

import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ko">
      <body className="min-h-dvh flex flex-col items-center justify-center gap-6 px-6 text-center">
        <PretendardStylesheet />
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold text-gray-900">
            화면을 불러오지 못했어요
          </h1>
          <p className="text-sm text-gray-500">
            잠시 뒤에 다시 열어 주세요. 계속 이러면 문의해 주시면 도와드릴게요.
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="rounded-xl bg-blue-500 px-5 py-3 text-sm font-semibold text-white active:bg-blue-600"
        >
          다시 열기
        </button>
      </body>
    </html>
  );
}
