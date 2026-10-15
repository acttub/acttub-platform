"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ApiError, errorMessage } from "@/lib/api/v2/errors";
import { getPgReviewResult, logoutPgReview, type PgReviewResult } from "@/lib/api/v2/pg-review";
import { describeResult } from "./pg-review-flow";

// 서버가 세션에 보관한 안전한 결과만 읽는다. 주소에는 authKey·state 가 남지 않는다(서버가 302 로 지운다).

const POLL_MS = 3_000;
const MAX_POLLS = 20;

type View =
  | { name: "loading" }
  | { name: "ready"; result: PgReviewResult }
  | { name: "signed_out" }
  | { name: "failed"; message: string };

const TONE_CLASS = {
  success: "bg-[#e8f7ee] text-[#0b6b2e]",
  danger: "bg-[#fdecec] text-[#a1262b]",
  pending: "bg-[#eef4ff] text-[#1b4fb8]",
  neutral: "bg-[#f2f4f6] text-[#4e5968]",
} as const;

export function PgReviewResultApp() {
  const [view, setView] = useState<View>({ name: "loading" });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    let polls = 0;

    const read = () => {
      getPgReviewResult(controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          setView({ name: "ready", result });
          if (describeResult(result).polling && polls < MAX_POLLS) {
            polls += 1;
            timer = window.setTimeout(read, POLL_MS);
          }
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
            setView({ name: "signed_out" });
            return;
          }
          setView({
            name: "failed",
            message: errorMessage(cause, "결과를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요."),
          });
        });
    };
    read();
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [reload]);

  const logout = useCallback(async () => {
    try {
      await logoutPgReview();
    } finally {
      setView({ name: "signed_out" });
    }
  }, []);

  return (
    <main className="ph-no-capture mx-auto min-h-dvh w-full max-w-3xl px-6 py-12 sm:py-16" data-ph-no-capture>
      <p className="text-sm font-semibold text-[#3182f6]">ACTTUB 결제 심사용 화면</p>
      <h1 className="mt-3 text-3xl font-bold tracking-[-0.03em] text-[#191f28]">테스트 결제 결과</h1>
      <div aria-live="polite" className="mt-8">
        {view.name === "loading" && <p role="status" className="text-base text-[#6b7684]">결과를 불러오는 중이에요.</p>}
        {view.name === "signed_out" && (
          <section className="rounded-3xl border border-[#e5e8eb] bg-white p-6">
            <p className="text-base leading-7 text-[#4e5968]">심사용 로그인이 끝났어요. 결과를 보려면 다시 로그인해 주세요.</p>
            <Link href="/pg-review" className="mt-4 inline-block font-semibold text-[#3182f6] underline underline-offset-4">로그인 화면으로</Link>
          </section>
        )}
        {view.name === "failed" && (
          <section role="alert" className="rounded-3xl border border-[#e5e8eb] bg-white p-6">
            <p className="text-base leading-7 text-[#4e5968]">{view.message}</p>
            <button type="button" onClick={() => { setView({ name: "loading" }); setReload((n) => n + 1); }} className="mt-4 min-h-11 font-semibold text-[#3182f6] underline underline-offset-4">
              다시 불러오기
            </button>
          </section>
        )}
        {view.name === "ready" && <ResultCard result={view.result} onRefresh={() => { setView({ name: "loading" }); setReload((n) => n + 1); }} onLogout={logout} />}
      </div>
    </main>
  );
}

function ResultCard({ result, onRefresh, onLogout }: { result: PgReviewResult; onRefresh: () => void; onLogout: () => void }) {
  const described = describeResult(result);
  return (
    <section className="rounded-3xl border border-[#e5e8eb] bg-white p-6 sm:p-8">
      <div className={`rounded-2xl p-5 ${TONE_CLASS[described.tone]}`}>
        <h2 className="text-xl font-bold">{described.title}</h2>
        <p className="mt-2 text-sm leading-7">{described.body}</p>
      </div>
      <dl className="mt-6 space-y-2 text-sm leading-6 text-[#4e5968]">
        <div><dt className="inline font-bold text-[#191f28]">상품 </dt><dd className="inline">ACTTUB Pro 월 구독 테스트 · {result.amount.toLocaleString("ko-KR")}원(부가세 포함)</dd></div>
        {result.orderId && <div><dt className="inline font-bold text-[#191f28]">주문번호 </dt><dd className="inline break-all">{result.orderId}</dd></div>}
        {result.approvedAt && <div><dt className="inline font-bold text-[#191f28]">승인 시각 </dt><dd className="inline">{formatTime(result.approvedAt)}</dd></div>}
        {result.errorCode && described.tone === "danger" && <div><dt className="inline font-bold text-[#191f28]">오류 코드 </dt><dd className="inline break-all">{result.errorCode}</dd></div>}
      </dl>
      <p className="mt-6 text-sm leading-6 text-[#6b7684]">테스트 결제예요. 실제 돈은 빠져나가지 않았고, 구독 권한과 자동 갱신은 없어요.</p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        {described.polling || result.status === "unknown" ? (
          <button type="button" onClick={onRefresh} className="min-h-12 rounded-2xl bg-[#3182f6] px-5 font-bold text-white">결과 다시 확인</button>
        ) : null}
        {described.canRetry && (
          <Link href="/pg-review" className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-[#3182f6] px-5 font-bold text-white">처음 화면으로</Link>
        )}
        <button type="button" onClick={onLogout} className="min-h-12 rounded-2xl border border-[#d1d6db] px-5 font-semibold text-[#4e5968]">심사용 로그아웃</button>
      </div>
    </section>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
}
