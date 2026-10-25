"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchMe, fetchProviders, login, signup, type LoginInput, type LoginResult, type SignupRequired } from "@/lib/api/v2/auth";
import { errorMessage } from "@/lib/api/v2/errors";
import type { ConsentDocument } from "@/lib/api/v2/types";
import { setMemberTokens, type TokenPair } from "@/lib/auth/token-store";
import { prepareGuestCarry, redeemGuestCarry } from "./carry-guest";
import {
  GOOGLE_WEB_CLIENT_ID,
  naverAuthorizeUrl,
  rememberNext,
  takeNaverPending,
  takeNext,
  webProviders,
  type WebProvider,
} from "./login-providers";

type GoogleId = {
  accounts: { id: { initialize: (o: object) => void; renderButton: (el: HTMLElement, o: object) => void } };
};

type Step =
  | { kind: "loading" }
  | { kind: "choose"; providers: WebProvider[] }
  | { kind: "busy"; text: string }
  | { kind: "signup"; signup: SignupRequired; provider: WebProvider }
  | { kind: "error"; message: string };

function loadGoogle(): Promise<GoogleId> {
  const existing = (window as unknown as { google?: GoogleId }).google;
  if (existing?.accounts?.id) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve((window as unknown as { google: GoogleId }).google);
    script.onerror = () => reject(new Error("google_script"));
    document.head.appendChild(script);
  });
}

/** 웹 로그인(SOMA-834). naverCallback 이면 네이버에서 돌아온 code 를 서버에 넘겨 이어 간다. */
export function WebLogin({ naverCallback = false }: { naverCallback?: boolean }) {
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const googleBox = useRef<HTMLDivElement>(null);

  const finish = useCallback(async (pair: TokenPair, provider: WebProvider) => {
    setStep({ kind: "busy", text: "로그인하는 중이에요" });
    // 회원 토큰으로 바꾸기 전에 user 를 알 수 없으므로 먼저 넣고 /v2/me 로 채운다.
    setMemberTokens(pair, { id: "", email: null, status: "active" }, provider);
    const me = await fetchMe().catch(() => null);
    if (me) setMemberTokens(pair, { id: me.id, email: me.email, status: me.status }, provider);
    await redeemGuestCarry();
    window.location.assign(takeNext());
  }, []);

  const handle = useCallback(
    async (input: LoginInput) => {
      setStep({ kind: "busy", text: "로그인하는 중이에요" });
      try {
        const result: LoginResult = await login(input);
        if (result.result === "signup_required") {
          setStep({ kind: "signup", signup: result, provider: input.provider });
          return;
        }
        await finish(result, input.provider);
      } catch (error) {
        setStep({ kind: "error", message: errorMessage(error, "로그인하지 못했어요. 잠시 뒤 다시 시도해 주세요.") });
      }
    },
    [finish],
  );

  useEffect(() => {
    let cancelled = false;
    if (naverCallback) {
      const params = new URLSearchParams(window.location.search);
      const pending = takeNaverPending();
      const code = params.get("code");
      const state = params.get("state");
      if (!pending || !code || state !== pending.state) {
        const message = params.get("error") ? "네이버 로그인을 마치지 못했어요." : "로그인 정보가 맞지 않아요. 다시 시도해 주세요.";
        void Promise.resolve().then(() => setStep({ kind: "error", message }));
        return;
      }
      const input: LoginInput = { provider: "naver", authorization_code: code, code_verifier: pending.verifier, redirect_uri: pending.redirectUri, state };
      void Promise.resolve().then(() => handle(input));
      return;
    }
    rememberNext(new URLSearchParams(window.location.search).get("next") ?? "/account");
    fetchProviders()
      .then((server) => {
        if (!cancelled) setStep({ kind: "choose", providers: webProviders(server) });
      })
      .catch(() => {
        if (!cancelled) setStep({ kind: "choose", providers: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [naverCallback, handle]);

  const providers = useMemo(() => (step.kind === "choose" ? step.providers : []), [step]);
  useEffect(() => {
    if (!providers.includes("google") || !googleBox.current) return;
    const box = googleBox.current;
    loadGoogle()
      .then((google) => {
        google.accounts.id.initialize({
          client_id: GOOGLE_WEB_CLIENT_ID,
          callback: async (response: { credential?: string }) => {
            if (!response.credential) return;
            await prepareGuestCarry();
            void handle({ provider: "google", id_token: response.credential });
          },
        });
        google.accounts.id.renderButton(box, { type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "rectangular", width: 320, locale: "ko" });
      })
      .catch(() => setStep({ kind: "error", message: "구글 로그인을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요." }));
  }, [providers, handle]);

  async function startNaver() {
    setStep({ kind: "busy", text: "네이버로 이동하는 중이에요" });
    await prepareGuestCarry();
    window.location.assign(await naverAuthorizeUrl(window.location.origin));
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      {step.kind === "loading" ? (
        <div aria-hidden="true" className="space-y-3">
          <div className="h-12 animate-pulse rounded-2xl bg-[#e5e8eb]" />
          <div className="h-12 animate-pulse rounded-2xl bg-[#e5e8eb]" />
        </div>
      ) : null}

      {step.kind === "choose" ? (
        <div className="space-y-3">
          {step.providers.length === 0 ? (
            <p className="rounded-2xl bg-white p-5 text-sm leading-6 text-[#4e5968] ring-1 ring-[#e5e8eb]">
              지금은 웹 로그인을 쓸 수 없어요. 앱에서 로그인해 주세요.
            </p>
          ) : null}
          {step.providers.map((provider) =>
            provider === "google" ? (
              <div key="google" ref={googleBox} className="flex min-h-12 justify-center" />
            ) : (
              <button
                key="naver"
                type="button"
                onClick={() => void startNaver()}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#03c75a] font-bold text-white"
              >
                <span className="text-lg font-black" aria-hidden="true">N</span>
                네이버로 계속하기
              </button>
            ),
          )}
          <p className="pt-2 text-center text-xs leading-5 text-[#8b95a1]">
            카카오·애플 로그인은 지금은 앱에서만 돼요.
            <br />
            로그인하면 이 브라우저에서 한 연습을 내 계정으로 옮겨요.
          </p>
        </div>
      ) : null}

      {step.kind === "busy" ? (
        <p role="status" className="rounded-2xl bg-white p-5 text-center text-base font-semibold text-[#4e5968] ring-1 ring-[#e5e8eb]">
          {step.text}
        </p>
      ) : null}

      {step.kind === "signup" ? (
        <SignupConsent
          documents={step.signup.documents}
          onSubmit={async (decisions) => {
            const pair = await signup(step.signup.signup_token, decisions);
            await finish(pair, step.provider);
          }}
        />
      ) : null}

      {step.kind === "error" ? (
        <div role="alert" className="space-y-3 rounded-2xl bg-white p-5 ring-1 ring-[#e5e8eb]">
          <p className="text-base leading-7 text-[#191f28]">{step.message}</p>
          <Link href="/login" className="inline-block font-semibold text-[#3182f6]">다시 로그인하기</Link>
        </div>
      ) : null}
    </div>
  );
}

function SignupConsent({
  documents,
  onSubmit,
}: {
  documents: ConsentDocument[];
  onSubmit: (decisions: { document_id: string; action: "granted" | "declined" }[]) => Promise<void>;
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [age, setAge] = useState(false);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const ready = age && documents.every((doc) => !doc.required || checked[doc.id]);

  async function submit() {
    if (!ready || sending) return;
    setSending(true);
    setFailed(null);
    try {
      await onSubmit(documents.map((doc) => ({ document_id: doc.id, action: checked[doc.id] ? "granted" : "declined" })));
    } catch (error) {
      setFailed(errorMessage(error, "가입하지 못했어요. 잠시 뒤 다시 시도해 주세요."));
      setSending(false);
    }
  }

  return (
    <div className="space-y-4 rounded-[28px] bg-white p-6 ring-1 ring-[#e5e8eb]">
      <h2 className="text-xl font-black">처음 오셨네요</h2>
      <p className="text-sm leading-6 text-[#4e5968]">가입하려면 아래 내용에 동의해 주세요.</p>
      <ul className="space-y-3">
        {documents.map((doc) => (
          <li key={doc.id}>
            <label className="flex items-start gap-3 text-sm leading-6">
              <input
                type="checkbox"
                className="mt-1 size-4"
                checked={Boolean(checked[doc.id])}
                onChange={(e) => setChecked((prev) => ({ ...prev, [doc.id]: e.target.checked }))}
              />
              <span>
                <span className={doc.required ? "font-bold text-[#3182f6]" : "font-bold text-[#8b95a1]"}>{doc.required ? "필수" : "선택"}</span>{" "}
                {doc.title}
                <details className="mt-1 text-xs text-[#8b95a1]">
                  <summary className="cursor-pointer">내용 보기</summary>
                  <p className="mt-2 whitespace-pre-line">{doc.body}</p>
                </details>
              </span>
            </label>
          </li>
        ))}
        <li>
          <label className="flex items-start gap-3 text-sm leading-6">
            <input type="checkbox" className="mt-1 size-4" checked={age} onChange={(e) => setAge(e.target.checked)} />
            <span><span className="font-bold text-[#3182f6]">필수</span> 만 14세 이상이에요</span>
          </label>
        </li>
      </ul>
      <button
        type="button"
        disabled={!ready || sending}
        onClick={() => void submit()}
        className="w-full rounded-2xl bg-[#3182f6] py-3.5 font-bold text-white disabled:bg-[#d1d6db]"
      >
        {sending ? "가입하는 중이에요" : "동의하고 가입하기"}
      </button>
      {failed ? <p role="alert" className="text-sm text-[#f04452]">{failed}</p> : null}
    </div>
  );
}
