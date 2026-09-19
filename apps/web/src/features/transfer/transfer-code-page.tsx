"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useGuestSession } from "@/features/consent/use-guest-session";
import { errorMessage, isGuestTransferred } from "@/lib/api/v2/errors";
import { requestTransferCode } from "@/lib/api/v2/guest-transfer";

import {
  formatRemaining,
  groupCode,
  issueTransferCode,
  remainingSeconds,
  transferCodeStatus,
  type IssuedTransferCode,
} from "./transfer-code";

/**
 * 이관 코드 화면(account.guest). 웹에서 한 연습을 앱의 회원 계정으로 옮길 때 쓰는 여섯 자리
 * 코드를 보여 준다. 10분 유효, 한 번 쓰면 끝, 새로 받으면 이전 코드는 무효다.
 *
 * 코드는 화면을 열 때가 아니라 버튼을 눌렀을 때 받는다 — 새로 받으면 이전 코드가 죽으므로,
 * 폰에 옮겨 적는 도중에 새로 고침 한 번으로 코드가 바뀌면 안 된다.
 */
export function TransferCodePage() {
  const { hasSession } = useGuestSession();
  const [issued, setIssued] = useState<IssuedTransferCode | null>(null);
  // 남은 시간을 그리는 시계. 렌더 중에 Date.now() 를 읽지 않으려고 state 로 든다.
  const [nowMs, setNowMs] = useState(0);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = transferCodeStatus(issued, nowMs);

  useEffect(() => {
    if (status !== "active") return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  async function issue() {
    if (issuing) return;
    setIssuing(true);
    setError(null);
    try {
      const response = await requestTransferCode();
      const receivedAt = Date.now();
      setNowMs(receivedAt);
      setIssued(issueTransferCode(response, receivedAt));
    } catch (cause) {
      // 이미 옮겨진 게스트라면 루트의 "옮겼어요" 안내가 뜬다. 같은 말을 두 번 하지 않는다.
      if (!isGuestTransferred(cause)) {
        setError(errorMessage(cause, "코드를 받지 못했어요. 다시 시도해 주세요."));
      }
    } finally {
      setIssuing(false);
    }
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[560px] px-5 py-8 text-[#191f28]">
      <Link
        href="/home"
        className="text-[13px] font-semibold text-[#8b95a1] transition hover:text-[#4e5968]"
      >
        ← 연습으로
      </Link>

      <h1 className="mt-4 text-[26px] font-black tracking-tight">앱으로 옮기기</h1>
      <p className="mt-3 text-[15px] leading-[1.6] text-[#6b7684]">
        이 브라우저에서 한 연습을 Acttub 앱의 내 계정으로 옮겨요. 영상과 질문 대화, 연습 노트가
        그대로 따라가요.
      </p>

      {!hasSession ? (
        <section className="mt-6 rounded-2xl bg-[#f9fafb] px-5 py-5">
          <p className="text-[15px] font-bold text-[#333d4b]">아직 옮길 연습이 없어요</p>
          <p className="mt-1.5 text-[14px] leading-[1.6] text-[#6b7684]">
            이 브라우저에서 연습을 시작하면 여기서 앱으로 옮길 수 있어요.
          </p>
          <Link
            href="/practice/new"
            className="mt-4 inline-flex h-11 items-center rounded-xl bg-[#3182f6] px-4 text-sm font-black text-white transition hover:bg-[#1b64da]"
          >
            연습 시작하기
          </Link>
        </section>
      ) : (
        <section className="mt-6 rounded-[24px] border border-[#e5e8eb] bg-white px-5 py-6 text-center sm:px-7">
          {status === "active" && issued ? (
            <>
              <p className="text-[13px] font-bold text-[#8b95a1]">앱에 넣을 코드</p>
              <p
                aria-label={`이관 코드 ${issued.code.split("").join(" ")}`}
                className="mt-2 text-[44px] font-black leading-none tracking-[0.06em] tabular-nums sm:text-[52px]"
              >
                {groupCode(issued.code)}
              </p>
              <p className="mt-3 text-sm font-bold text-[#3182f6] tabular-nums">
                남은 시간 {formatRemaining(remainingSeconds(issued, nowMs))}
              </p>
            </>
          ) : status === "expired" ? (
            <p className="text-[15px] font-bold text-[#333d4b]">
              코드가 만료됐어요. 새 코드를 받아 주세요.
            </p>
          ) : (
            <p className="text-[15px] font-bold text-[#333d4b]">
              코드를 받으면 10분 동안 쓸 수 있어요.
            </p>
          )}

          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-xl bg-[#fff1f0] px-4 py-3 text-[14px] font-semibold text-[#d94a3d]"
            >
              {error}
            </p>
          ) : null}

          <button
            type="button"
            disabled={issuing}
            onClick={() => void issue()}
            className={
              status === "active"
                ? "mt-5 h-11 rounded-xl px-4 text-sm font-bold text-[#6b7684] transition hover:bg-[#f2f4f6] disabled:opacity-60"
                : "mt-5 h-14 w-full rounded-2xl bg-[#3182f6] px-5 text-base font-semibold text-white transition hover:bg-[#1b64da] disabled:cursor-not-allowed disabled:bg-[#b0d2ff]"
            }
          >
            {issuing
              ? "코드를 받고 있어요"
              : status === "active"
                ? "새 코드 받기"
                : status === "expired"
                  ? "다시 받기"
                  : "코드 받기"}
          </button>
          {status === "active" ? (
            <p className="mt-1 text-xs font-semibold text-[#8b95a1]">
              새 코드를 받으면 이 코드는 쓸 수 없어요.
            </p>
          ) : null}
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-[15px] font-black">앱에서 넣는 방법</h2>
        <ol className="mt-3 space-y-2.5 text-[14px] font-semibold leading-[1.6] text-[#4e5968]">
          <li>1. Acttub 앱을 열고 로그인해요.</li>
          <li>2. 설정에서 코드 입력 화면을 열어요.</li>
          <li>3. 위의 여섯 자리 코드를 넣어요.</li>
        </ol>
        <ul className="mt-4 space-y-1.5 text-[13px] leading-[1.6] text-[#8b95a1]">
          <li>코드는 10분 동안 한 번만 쓸 수 있어요.</li>
          <li>옮긴 뒤에는 이 브라우저의 연습이 앱으로 넘어가고, 웹에서는 새로 시작해요.</li>
        </ul>
        <Link
          href="/app"
          className="mt-5 inline-flex h-11 items-center rounded-xl bg-[#e8f3ff] px-4 text-sm font-black text-[#3182f6] transition hover:bg-[#d7e9ff]"
        >
          앱 다운로드
        </Link>
      </section>
    </main>
  );
}
