"use client";

import Link from "next/link";
import {
  FormEvent,
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError } from "../../lib/api/v2/errors";
import { renderGoogleLoginButton } from "../../lib/auth/google-gis";
import {
  detectInAppBrowser,
  externalBrowserUrl,
  inAppBrowserNotice,
  type InAppBrowser,
} from "../../lib/auth/in-app-browser";
import {
  developmentProvider,
  googleProvider,
  loginWith,
} from "../../lib/auth/providers";
import { sanitizeNextPath } from "../../lib/auth/next-path";
import { GOOGLE_CLIENT_ID } from "../../lib/config/env";
import {
  clearPendingConsents,
  savePendingConsents,
} from "../../features/auth/pending-consents";

// UA는 세션 동안 불변이므로 구독 없이 스냅샷만 읽는다. 서버(프리렌더)에서는 null.
const subscribeNever = () => () => {};
const getInAppBrowserSnapshot = () => detectInAppBrowser(navigator.userAgent);
const getServerInAppBrowserSnapshot = () => null;

function loginErrorMessage(error: unknown): string {
  if (
    error instanceof ApiError &&
    error.status === 401 &&
    error.code === "invalid_provider_token"
  ) {
    return "로그인 정보가 올바르지 않아요";
  }
  if (
    error instanceof ApiError &&
    error.status === 403 &&
    error.code === "account_suspended"
  ) {
    return "정지된 계정이에요";
  }
  return "로그인하지 못했어요. 잠시 후 다시 시도해 주세요";
}

function GoogleLoginButton({
  onCredential,
  onLoadError,
}: {
  onCredential: (credential: string) => void;
  onLoadError: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // GIS callback은 initialize 시점의 클로저를 계속 쓰므로 ref로 최신 핸들러를 참조한다.
  const onCredentialRef = useRef(onCredential);
  const onLoadErrorRef = useRef(onLoadError);
  useEffect(() => {
    onCredentialRef.current = onCredential;
    onLoadErrorRef.current = onLoadError;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    const render = () =>
      renderGoogleLoginButton({
        clientId: GOOGLE_CLIENT_ID,
        container,
        // 언마운트 뒤 늦게 도착한 credential이 로그인을 실행하지 않도록 가드한다.
        onCredential: (credential) => {
          if (!cancelled) onCredentialRef.current(credential);
        },
      }).catch(() => {
        if (!cancelled) onLoadErrorRef.current();
      });

    // ResizeObserver는 observe 직후 1회 발화하므로 초기 렌더도 이 경로로 처리하고,
    // 회전 등으로 컨테이너 폭이 바뀌면 새 폭으로 다시 그린다 (렌더는 last-wins).
    let lastWidth = -1;
    const observer = new ResizeObserver(() => {
      if (cancelled) return;
      const width = Math.round(container.offsetWidth);
      if (width === lastWidth) return;
      lastWidth = width;
      void render();
    });
    observer.observe(container);

    return () => {
      cancelled = true;
      observer.disconnect();
      // StrictMode 이중 실행 시 버튼이 중복 렌더되지 않도록 정리한다.
      container.replaceChildren();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex min-h-14 w-full items-center justify-center"
      aria-label="Google 로그인"
    />
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = sanitizeNextPath(searchParams.get("next"));
  const noticeMessage =
    searchParams.get("notice") === "account_suspended"
      ? "정지된 계정이에요"
      : searchParams.get("notice") === "consents_updated"
        ? "약관 정보가 바뀌어 다시 로그인이 필요해요"
        : null;
  const [uid, setUid] = useState("");
  const [email, setEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inAppBrowser: InAppBrowser | null = useSyncExternalStore(
    subscribeNever,
    getInAppBrowserSnapshot,
    getServerInAppBrowserSnapshot,
  );

  // 인앱 브라우저(WebView)에서는 Google이 OAuth를 차단하므로,
  // 탈출 수단이 있는 브라우저는 기본 브라우저로 이동시키고 안내를 남긴다.
  useEffect(() => {
    if (!inAppBrowser) return;
    const escapeUrl = externalBrowserUrl(inAppBrowser, window.location.href);
    if (escapeUrl) window.location.href = escapeUrl;
  }, [inAppBrowser]);

  async function submitLogin(request: () => ReturnType<typeof loginWith>) {
    if (isSubmitting) return;

    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const result = await request();
      if (result.pending_consents.length > 0) {
        savePendingConsents(result.pending_consents);
        router.replace(`/terms?next=${encodeURIComponent(nextPath)}`);
        return;
      }

      clearPendingConsents();
      router.replace(nextPath);
    } catch (error) {
      setErrorMessage(loginErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitLogin(() => loginWith(developmentProvider, { uid, email }));
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#f2f4f6] px-5 py-12 text-[#191f28]">
      <section className="w-full max-w-md rounded-[32px] bg-white p-7 shadow-[0_24px_80px_rgba(25,31,40,0.1)] sm:p-9">
        <Link href="/" className="text-xl font-black tracking-[-0.04em]">
          Acttub
        </Link>
        <p className="mt-10 text-sm font-black text-[#3182f6]">연기 복기 시작하기</p>
        <h1 className="mt-3 text-3xl font-black leading-tight tracking-[-0.05em]">
          로그인하고
          <br />내 장면을 이어가세요
        </h1>
        <p className="mt-4 text-base font-semibold leading-7 text-[#6b7684]">
          영상과 장면 맥락을 안전하게 보관하고, 질문과 연습 노트를 이어서 볼 수 있어요.
        </p>

        <div className="mt-9 space-y-5">
          {inAppBrowser ? (
            <p
              role="status"
              className="rounded-2xl bg-[#fff6e5] px-4 py-3 text-sm font-bold text-[#b25c00]"
            >
              {inAppBrowserNotice(inAppBrowser)}
            </p>
          ) : null}
          <GoogleLoginButton
            onCredential={(credential) =>
              void submitLogin(() => loginWith(googleProvider, { credential }))
            }
            onLoadError={() =>
              setErrorMessage(
                "Google 로그인을 불러오지 못했어요. 새로고침 후 다시 시도해 주세요",
              )
            }
          />

          {process.env.NODE_ENV === "development" ? (
            <form
              className="space-y-5 rounded-3xl border border-[#e5e8eb] bg-[#f9fafb] p-5"
              onSubmit={handleSubmit}
            >
              <p className="text-sm font-black text-[#6b7684]">
                개발용 테스트 로그인을 사용해요
              </p>
              <label className="block">
                <span className="text-sm font-black text-[#333d4b]">사용자 ID</span>
                <input
                  required
                  value={uid}
                  onChange={(event) => setUid(event.target.value)}
                  placeholder="연습용 ID를 입력해 주세요"
                  autoComplete="username"
                  className="mt-2 h-14 w-full rounded-2xl border border-[#e5e8eb] bg-white px-4 text-base font-bold outline-none transition placeholder:text-[#b0b8c1] focus:border-[#3182f6] focus:ring-4 focus:ring-[#e8f3ff]"
                />
              </label>
              <label className="block">
                <span className="text-sm font-black text-[#333d4b]">
                  이메일 <span className="text-[#8b95a1]">(선택)</span>
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="actor@example.com"
                  autoComplete="email"
                  className="mt-2 h-14 w-full rounded-2xl border border-[#e5e8eb] bg-white px-4 text-base font-bold outline-none transition placeholder:text-[#b0b8c1] focus:border-[#3182f6] focus:ring-4 focus:ring-[#e8f3ff]"
                />
              </label>

              <button
                type="submit"
                disabled={isSubmitting}
                className="flex h-14 w-full items-center justify-center rounded-2xl bg-[#3182f6] text-base font-black text-white shadow-[0_12px_30px_rgba(49,130,246,0.25)] transition hover:bg-[#1b64da] disabled:cursor-wait disabled:bg-[#8fbffa]"
              >
                개발용 로그인
              </button>
            </form>
          ) : null}

          {isSubmitting ? (
            <p className="text-center text-sm font-bold text-[#6b7684]">
              로그인 중...
            </p>
          ) : null}
          {errorMessage || noticeMessage ? (
            <p
              role="alert"
              className="rounded-2xl bg-[#fff0f0] px-4 py-3 text-sm font-bold text-[#e42939]"
            >
              {errorMessage ?? noticeMessage}
            </p>
          ) : null}
        </div>

        <p className="mt-7 text-center text-xs font-semibold leading-5 text-[#8b95a1]">
          로그인하면 Acttub의 이용약관과 개인정보 처리 원칙을 확인할 수 있어요.
        </p>
      </section>
    </main>
  );
}

function LoginFallback() {
  return <main className="min-h-dvh bg-[#f2f4f6]" aria-busy="true" />;
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}
