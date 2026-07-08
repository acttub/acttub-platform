"use client";

import { useEffect, useState } from "react";
import { acceptTerms, getAuthSession, type AuthSessionResponse } from "@/lib/api/auth";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; session: AuthSessionResponse }
  | { kind: "error"; message: string };

export function TermsGate() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;

    getAuthSession()
      .then((session) => {
        if (!mounted) return;
        if (!session.authenticated) {
          window.location.href = "/auth/login";
          return;
        }
        if (session.terms.accepted) {
          window.location.href = "/practice";
          return;
        }
        setState({ kind: "ready", session });
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        setState({
          kind: "error",
          message: error instanceof Error ? error.message : "확인 정보를 불러오지 못했어요.",
        });
      });

    return () => {
      mounted = false;
    };
  }, []);

  async function handleAccept() {
    if (state.kind !== "ready") return;

    setSubmitting(true);
    try {
      const response = await acceptTerms({ termsVersion: state.session.terms.requiredVersion });
      window.location.href = response.nextPath;
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "확인 요청을 마치지 못했어요.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center px-6 py-12">
      <p className="text-sm font-semibold text-[#3182f6]">Acttub 시작 전 확인</p>
      <h1 className="mt-3 text-3xl font-bold tracking-[-0.03em] text-[#191f28]">
        질문 연습을 안전하게 이어가기 위한 약속
      </h1>
      <div className="mt-8 rounded-3xl border border-[#e5e8eb] bg-white p-6 text-base leading-7 text-[#4e5968] shadow-sm">
        <p>
          Acttub은 장면을 단정하지 않고, 사용자가 직접 생각과 선택을 정리하도록 질문을 건네는
          연습 도구입니다.
        </p>
        <ul className="mt-5 list-disc space-y-2 pl-5">
          <li>영상과 장면 맥락은 질문 흐름을 만들기 위해 사용합니다.</li>
          <li>불확실한 관찰은 먼저 확인하고, 아니라고 표시한 관찰은 질문 근거에서 제외합니다.</li>
          <li>마지막 문장은 AI가 아니라 사용자가 직접 남깁니다.</li>
        </ul>
      </div>

      {state.kind === "loading" ? (
        <p className="mt-6 rounded-2xl bg-[#f2f4f6] p-4 text-sm text-[#4e5968]">확인 정보를 불러오는 중이에요.</p>
      ) : null}

      {state.kind === "error" ? (
        <p className="mt-6 rounded-2xl bg-[#fff4f4] p-4 text-sm text-[#d92d20]">{state.message}</p>
      ) : null}

      <button
        type="button"
        disabled={state.kind !== "ready" || submitting}
        onClick={handleAccept}
        className="mt-8 h-14 w-full rounded-2xl bg-[#3182f6] px-5 text-base font-semibold text-white transition hover:bg-[#1b64da] disabled:cursor-not-allowed disabled:bg-[#b0d2ff]"
      >
        {submitting ? "확인 중이에요" : "확인하고 연습 시작하기"}
      </button>
      {state.kind === "ready" ? (
        <p className="mt-4 text-sm text-[#8b95a1]">약관 버전: {state.session.terms.requiredVersion}</p>
      ) : null}
    </main>
  );
}
