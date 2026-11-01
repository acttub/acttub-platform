"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { StoreBadges } from "@/features/app-download/store-badges";
import { useAppDownloadHref } from "@/features/app-download/app-download-button";
import { ConsentMarkdown } from "@/features/consent/consent-markdown";
import { fetchMe, fetchProviders, login, signup, type LoginInput } from "@/lib/api/v2/auth";
import { errorMessage } from "@/lib/api/v2/errors";
import type { ConsentDocument } from "@/lib/api/v2/types";
import { clearLoginExpired } from "@/lib/auth/login-expired";
import { setMemberTokens, type TokenPair } from "@/lib/auth/token-store";

import {
  GOOGLE_WEB_CLIENT_ID,
  naverAuthorizeUrl,
  peekNext,
  rememberNext,
  takeNaverPending,
  takeNext,
  webProviders,
  type WebProvider,
} from "./login-providers";
import {
  buildDecisions,
  canSubmit,
  consentLines,
  lineChecked,
  signupFailureAction,
  toggleAll,
  toggleLine,
  type ConsentChoice,
} from "./signup-consent";

/**
 * 웹 가입·로그인(SOMA-834). /signup 과 /login 이 같은 흐름을 쓴다 — 제목과 아래 안내만 다르다.
 * 순서: 소셜 선택 → (처음 온 신원이면) 동의 → 가입 완료. 이미 있는 계정이면 바로 next(기본 /account)로 간다.
 * 네이버에서 돌아온 화면(naverCallback)도 같은 흐름이고, 가입이 필요하면 같은 동의 단계로 이어진다.
 */
type Mode = "login" | "signup";

type Step =
  | { kind: "loading" }
  | { kind: "choose"; providers: WebProvider[] }
  | { kind: "busy"; text: string }
  | { kind: "consent"; signupToken: string; documents: ConsentDocument[]; provider: WebProvider }
  | { kind: "done" }
  | { kind: "error"; message: string };

type GoogleId = {
  accounts: { id: { initialize: (o: object) => void; renderButton: (el: HTMLElement, o: object) => void } };
};

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

const COPY: Record<Mode, { title: string; lead: string; swap: string; swapHref: string; swapLabel: string }> = {
  signup: {
    title: "액터브 계정 만들기",
    lead: "앱과 같은 계정이에요. 웹에서 만들고\n앱에서 같은 방법으로 로그인하면 돼요.",
    swap: "이미 계정이 있나요?",
    swapHref: "/login",
    swapLabel: "로그인",
  },
  login: {
    title: "로그인",
    lead: "앱에서 쓰던 계정 그대로 로그인해요.",
    swap: "계정이 없나요?",
    swapHref: "/signup",
    swapLabel: "가입하기",
  },
};

const PROVIDER_NAME: Record<WebProvider, string> = { google: "구글", naver: "네이버" };

export function AuthFlow({ mode, naverCallback = false }: { mode: Mode; naverCallback?: boolean }) {
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [more, setMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const googleBox = useRef<HTMLDivElement>(null);
  const copy = COPY[mode];

  /** 토큰을 저장하고(앱 로그인과 같은 자리) 이름을 채운다. */
  const storeSession = useCallback(async (pair: TokenPair, provider: WebProvider) => {
    clearLoginExpired();
    setMemberTokens(pair, { id: "", email: null, status: "active" }, provider);
    const me = await fetchMe().catch(() => null);
    if (me) setMemberTokens(pair, { id: me.id, email: me.email, status: me.status, name: me.profile?.name ?? null }, provider);
  }, []);

  const handle = useCallback(
    async (input: LoginInput) => {
      setStep({ kind: "busy", text: "확인하는 중이에요" });
      try {
        const result = await login(input);
        if (result.result === "signup_required") {
          // 웹에서 처음 온 신원이면 로그인 화면에서도 가입 동의로 이어 간다.
          setStep({ kind: "consent", signupToken: result.signup_token, documents: result.documents, provider: input.provider });
          return;
        }
        await storeSession(result, input.provider);
        window.location.assign(takeNext());
      } catch (error) {
        setStep({ kind: "error", message: errorMessage(error, "로그인하지 못했어요. 잠시 뒤 다시 시도해 주세요.") });
      }
    },
    [storeSession],
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

  /** 처음 화면으로 되돌린다. 네이버에서 돌아온 화면이면 next 를 지키며 원래 화면으로 간다. */
  function restart() {
    if (naverCallback) {
      window.location.assign(`/${mode}?next=${encodeURIComponent(peekNext())}`);
      return;
    }
    setStep({ kind: "loading" });
    setAttempt((n) => n + 1);
  }

  async function submitConsent(signupToken: string, documents: ConsentDocument[], choices: Record<string, ConsentChoice>, provider: WebProvider) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const pair = await signup(signupToken, buildDecisions(documents, choices));
      await storeSession(pair, provider);
      setStep({ kind: "done" });
    } catch (error) {
      if (signupFailureAction(error) === "restart") {
        setStep({ kind: "error", message: "가입 정보가 바뀌었어요. 처음부터 다시 해 주세요." });
      } else {
        setSubmitError(errorMessage(error, "가입하지 못했어요. 잠시 뒤 다시 시도해 주세요."));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const providers = useMemo(() => (step.kind === "choose" ? step.providers : []), [step]);
  // 첫 번째 제공자가 큰 버튼, 나머지는 「다른 방법으로」 아래. 카카오가 열리면 카카오가 맨 앞에 온다(login-providers.ts TODO).
  const primary = providers[0];
  const rest = providers.slice(1);
  const googleShown = primary === "google" || (more && rest.includes("google"));

  useEffect(() => {
    if (!googleShown || !googleBox.current) return;
    const box = googleBox.current;
    loadGoogle()
      .then((google) => {
        google.accounts.id.initialize({
          client_id: GOOGLE_WEB_CLIENT_ID,
          callback: (response: { credential?: string }) => {
            if (!response.credential) return;
            void handle({ provider: "google", id_token: response.credential });
          },
        });
        google.accounts.id.renderButton(box, { type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "rectangular", width: 360, locale: "ko" });
      })
      .catch(() => setStep({ kind: "error", message: "구글 로그인을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요." }));
  }, [googleShown, handle]);

  async function startNaver() {
    setStep({ kind: "busy", text: "네이버로 이동하는 중이에요" });
    window.location.assign(await naverAuthorizeUrl(window.location.origin));
  }

  function providerButton(provider: WebProvider, big: boolean) {
    if (provider === "google") return <div key="google" ref={googleBox} className="flex min-h-12 justify-center" />;
    return (
      <button
        key={provider}
        type="button"
        onClick={() => void startNaver()}
        className={`flex h-14 w-full items-center justify-center gap-2 rounded-2xl font-bold ${big ? "bg-[#03c75a] text-white" : "bg-white text-[#191f28] ring-1 ring-[#e5e8eb]"}`}
      >
        <span className={`flex h-6 w-6 items-center justify-center rounded text-sm font-black ${big ? "bg-white text-[#03c75a]" : "bg-[#03c75a] text-white"}`} aria-hidden="true">N</span>
        {PROVIDER_NAME[provider]}로 계속하기
      </button>
    );
  }

  if (step.kind === "consent") {
    return (
      <ConsentStep
        documents={step.documents}
        error={submitError}
        busy={submitting}
        onSubmit={(choices) => void submitConsent(step.signupToken, step.documents, choices, step.provider)}
      />
    );
  }

  if (step.kind === "done") return <DoneStep />;

  return (
    <div className="w-full max-w-[400px]">
      <h1 className="text-[32px] font-black leading-[1.3] tracking-[-0.03em] text-[#191f28]">{copy.title}</h1>
      <p className="mt-4 whitespace-pre-line text-base leading-[1.7] text-[#4e5968]">{copy.lead}</p>

      <div className="mt-9">
        {step.kind === "loading" ? (
          <div aria-hidden="true" className="space-y-3">
            <div className="h-14 animate-pulse rounded-2xl bg-[#e5e8eb]" />
            <div className="h-14 animate-pulse rounded-2xl bg-[#e5e8eb]" />
          </div>
        ) : null}

        {step.kind === "choose" ? (
          <div className="space-y-3">
            {providers.length === 0 ? (
              <p className="text-sm leading-6 text-[#4e5968]">지금은 웹에서 계속할 수 없어요. 앱에서 가입하거나 로그인해 주세요.</p>
            ) : null}
            {primary ? providerButton(primary, true) : null}
            {rest.length > 0 ? (
              <>
                <button
                  type="button"
                  aria-expanded={more}
                  onClick={() => setMore((v) => !v)}
                  className="flex w-full items-center gap-3 py-2 text-sm text-[#6b7684]"
                >
                  <span className="h-px flex-1 bg-[#e5e8eb]" />
                  다른 방법으로 {more ? "▴" : "▾"}
                  <span className="h-px flex-1 bg-[#e5e8eb]" />
                </button>
                {more ? rest.map((p) => providerButton(p, false)) : null}
              </>
            ) : null}
          </div>
        ) : null}

        {step.kind === "busy" ? (
          <p role="status" className="text-base font-semibold text-[#4e5968]">{step.text}</p>
        ) : null}

        {step.kind === "error" ? (
          <div role="alert" className="space-y-3">
            <p className="text-base leading-7 text-[#191f28]">{step.message}</p>
            <button type="button" onClick={restart} className="font-semibold text-[#3182f6]">처음부터 다시 하기</button>
          </div>
        ) : null}
      </div>

      <p className="mt-9 text-center text-[15px] text-[#4e5968]">
        {copy.swap}{" "}
        <Link href={copy.swapHref} className="font-bold text-[#3182f6]">{copy.swapLabel}</Link>
      </p>
      <p className="mt-3 text-center text-sm text-[#8b95a1]">
        카카오·애플 로그인은 지금은 앱에서만 돼요.
      </p>
    </div>
  );
}

function ConsentStep({
  documents,
  error,
  busy,
  onSubmit,
}: {
  documents: ConsentDocument[];
  error: string | null;
  busy: boolean;
  onSubmit: (choices: Record<string, ConsentChoice>) => void;
}) {
  const lines = useMemo(() => consentLines(documents), [documents]);
  // 선택 항목은 처음에 모두 꺼져 있다.
  const [choices, setChoices] = useState<Record<string, ConsentChoice>>({});
  const [age, setAge] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const all = lines.length > 0 && lines.every((l) => lineChecked(l, choices, age));
  const ready = canSubmit(documents, choices, age) && !busy;

  function apply(next: { choices: Record<string, ConsentChoice>; ageConfirmed: boolean }) {
    setChoices(next.choices);
    setAge(next.ageConfirmed);
  }

  return (
    <div className="w-full max-w-[440px]">
      <h1 className="text-[32px] font-black leading-[1.3] tracking-[-0.03em] text-[#191f28]">약관에 동의해 주세요</h1>
      <p className="mt-4 text-base leading-[1.7] text-[#4e5968]">동의하면 바로 계정이 만들어져요.</p>

      <button
        type="button"
        role="checkbox"
        aria-checked={all}
        onClick={() => apply(toggleAll(lines, choices, age))}
        className="mt-8 flex w-full items-center gap-3 border-b border-[#e5e8eb] pb-4 text-left text-lg font-extrabold text-[#191f28]"
      >
        <Check on={all} />
        모두 동의하기
      </button>

      <ul className="divide-y divide-[#f2f4f6]">
        {lines.map((line) => {
          const on = lineChecked(line, choices, age);
          const expanded = open === line.key;
          return (
            <li key={line.key} className="py-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => apply(toggleLine(line, choices, age))}
                  className="flex flex-1 items-center gap-3 text-left text-[15px] leading-6 text-[#191f28]"
                >
                  <Check on={on} />
                  <span>
                    <span className={line.required ? "font-bold text-[#3182f6]" : "font-bold text-[#8b95a1]"}>[{line.required ? "필수" : "선택"}]</span>{" "}
                    {line.label}
                  </span>
                </button>
                {line.documents.length > 0 ? (
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? null : line.key)}
                    className="shrink-0 text-sm font-semibold text-[#8b95a1] underline underline-offset-2"
                  >
                    {expanded ? "접기" : "보기"}
                  </button>
                ) : null}
              </div>
              {expanded ? (
                <div className="mt-3 max-h-64 space-y-3 overflow-y-auto rounded-2xl bg-[#f9fafb] p-4 text-sm leading-6 text-[#4e5968]">
                  {line.documents.map((d) => (
                    <section key={d.id}>
                      <h2 className="font-bold text-[#191f28]">{d.title}</h2>
                      <ConsentMarkdown source={d.body} />
                    </section>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {error ? <p role="alert" className="mt-4 text-sm leading-6 text-[#f04452]">{error}</p> : null}
      <button
        type="button"
        disabled={!ready}
        onClick={() => onSubmit(choices)}
        className="mt-6 h-14 w-full rounded-2xl bg-[#3182f6] text-[17px] font-bold text-white disabled:bg-[#e5e8eb] disabled:text-[#8b95a1]"
      >
        {busy ? "계정을 만드는 중이에요" : "동의하고 가입하기"}
      </button>
    </div>
  );
}

function Check({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-black ${on ? "bg-[#3182f6] text-white" : "bg-[#f2f4f6] text-transparent ring-1 ring-[#e5e8eb]"}`}
    >
      ✓
    </span>
  );
}

function DoneStep() {
  const appHref = useAppDownloadHref("landing_hero");
  return (
    <div className="w-full max-w-[400px]">
      <h1 className="text-[32px] font-black leading-[1.3] tracking-[-0.03em] text-[#191f28]">가입이 끝났어요</h1>
      <p className="mt-4 text-base leading-[1.7] text-[#4e5968]">앱을 열고 같은 방법으로 로그인하면 돼요.</p>
      <a
        href={appHref}
        data-app-download="landing_hero"
        className="mt-8 flex h-14 w-full items-center justify-center rounded-2xl bg-[#3182f6] text-[17px] font-bold text-white"
      >
        앱 열기 · 무료로 설치
      </a>
      <div className="mt-8 hidden items-center gap-4 lg:flex">
        <Image src="/site/app-qr.svg" alt="앱 설치 QR 코드" width={96} height={96} unoptimized className="rounded-xl border border-[#e5e8eb] bg-white p-2" />
        <p className="text-sm leading-6 text-[#6b7684]">휴대폰 카메라로 찍으면
          <br />설치 화면으로 가요.</p>
      </div>
      <StoreBadges surface="landing_hero" className="mt-6 lg:hidden" />
      <p className="mt-8 text-[15px]">
        <Link href="/account" className="font-bold text-[#3182f6]">내 계정 보기</Link>
      </p>
    </div>
  );
}
