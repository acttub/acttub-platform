"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StoreBadges } from "@/features/app-download/store-badges";
import { fetchMe, fetchProviders, login, type LoginInput, type LoginResult } from "@/lib/api/v2/auth";
import { errorMessage } from "@/lib/api/v2/errors";
import { setMemberTokens, type TokenPair } from "@/lib/auth/token-store";
import { clearLoginExpired } from "@/lib/auth/login-expired";
import { backupGuestBeforeLogin, redeemGuestCarry } from "./carry-guest";
import {
  GOOGLE_WEB_CLIENT_ID,
  naverAuthorizeUrl,
  rememberNext,
  takeNaverPending,
  peekNext,
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
  | { kind: "no-account" }
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
  const [attempt, setAttempt] = useState(0);
  const googleBox = useRef<HTMLDivElement>(null);

  const finish = useCallback(async (pair: TokenPair, provider: WebProvider) => {
    setStep({ kind: "busy", text: "로그인하는 중이에요" });
    // 회원 토큰이 게스트 자리를 덮기 전에 게스트 토큰을 따로 둔다. 옮기기가 끝나야 지운다.
    backupGuestBeforeLogin();
    clearLoginExpired();
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
          // 웹에는 프로필 입력 화면이 없어 새 계정을 만들면 코칭·리딩이 막힌다. 가입은 앱에서 한다.
          setStep({ kind: "no-account" });
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
  }, [naverCallback, handle, attempt]);

  /** 처음 화면으로 되돌린다. 네이버에서 돌아온 화면이면 next 를 지키며 /login 으로 간다. */
  function retry() {
    if (naverCallback) {
      window.location.assign(`/login?next=${encodeURIComponent(peekNext())}`);
      return;
    }
    setStep({ kind: "loading" });
    setAttempt((n) => n + 1);
  }

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
            void handle({ provider: "google", id_token: response.credential });
          },
        });
        google.accounts.id.renderButton(box, { type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "rectangular", width: 320, locale: "ko" });
      })
      .catch(() => setStep({ kind: "error", message: "구글 로그인을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요." }));
  }, [providers, handle]);

  async function startNaver() {
    setStep({ kind: "busy", text: "네이버로 이동하는 중이에요" });
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
            앱에서 만든 계정으로 로그인하면 이 브라우저에서 한 연습을 내 계정으로 옮겨요.
          </p>
        </div>
      ) : null}

      {step.kind === "busy" ? (
        <p role="status" className="rounded-2xl bg-white p-5 text-center text-base font-semibold text-[#4e5968] ring-1 ring-[#e5e8eb]">
          {step.text}
        </p>
      ) : null}

      {step.kind === "no-account" ? (
        <div role="status" className="space-y-3 rounded-2xl bg-white p-5 ring-1 ring-[#e5e8eb]">
          <p className="text-base font-bold text-[#191f28]">아직 앱에서 만든 계정이 없어요</p>
          <p className="text-sm leading-6 text-[#4e5968]">
            웹 로그인은 앱에서 만든 계정으로 할 수 있어요. 앱에서 가입하고 프로필을 채운 뒤 다시 와 주세요. 그동안은 로그인 없이 웹에서 연습할 수 있어요.
          </p>
          <StoreBadges surface="app_page" />
          <div className="flex gap-4 pt-1 text-sm font-semibold">
            <Link href="/practice/new" className="text-[#3182f6]">로그인 없이 연습하기</Link>
            <button type="button" onClick={retry} className="text-[#4e5968]">다른 계정으로 로그인</button>
          </div>
        </div>
      ) : null}

      {step.kind === "error" ? (
        <div role="alert" className="space-y-3 rounded-2xl bg-white p-5 ring-1 ring-[#e5e8eb]">
          <p className="text-base leading-7 text-[#191f28]">{step.message}</p>
          <button type="button" onClick={retry} className="inline-block font-semibold text-[#3182f6]">다시 로그인하기</button>
        </div>
      ) : null}
    </div>
  );
}
