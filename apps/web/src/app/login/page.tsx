"use client";

import Link from "next/link";
import Image from "next/image";
import {
  FormEvent,
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import wordmark from "../../assets/acttub-wordmark.png";
import { NamePrompt } from "../../features/auth/name-prompt";
import { useDisplayNameGate } from "../../features/auth/use-display-name-gate";
import { ApiError } from "../../lib/api/v2/errors";
import {
  isAppleSignInCancelled,
  requestAppleIdToken,
} from "../../lib/auth/apple-id";
import { renderGoogleLoginButton } from "../../lib/auth/google-gis";
import {
  detectInAppBrowser,
  externalBrowserUrl,
  googleLoginNotices,
  type InAppBrowser,
} from "../../lib/auth/in-app-browser";
import {
  appleProvider,
  developmentProvider,
  googleProvider,
  loginWith,
} from "../../lib/auth/providers";
import { sanitizeNextPath } from "../../lib/auth/next-path";
import {
  APPLE_CLIENT_ID,
  APPLE_REDIRECT_PATH,
  GOOGLE_CLIENT_ID,
} from "../../lib/config/env";
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
  // 서버가 아직 해당 로그인 방식을 지원하지 않는 배포 상태 (400 unsupported_provider).
  if (
    error instanceof ApiError &&
    error.status === 400 &&
    error.code === "unsupported_provider"
  ) {
    return "지금은 이 방법으로 로그인할 수 없어요. 다른 방법을 사용해 주세요";
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

// Apple HIG: 검은 배경 + 흰 로고, 문구는 "Apple로 계속하기" 계열만 허용된다.
function AppleLoginButton({
  disabled,
  onIdToken,
  onError,
}: {
  disabled: boolean;
  onIdToken: (idToken: string) => void;
  onError: (message: string) => void;
}) {
  const [isOpening, setIsOpening] = useState(false);

  async function handleClick() {
    if (isOpening) return;
    setIsOpening(true);
    try {
      const idToken = await requestAppleIdToken({
        clientId: APPLE_CLIENT_ID,
        redirectUri: `${window.location.origin}${APPLE_REDIRECT_PATH}`,
      });
      onIdToken(idToken);
    } catch (error) {
      // 사용자가 팝업을 닫은 건 오류가 아니므로 조용히 넘긴다.
      if (!isAppleSignInCancelled(error)) {
        onError("Apple 로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요");
      }
    } finally {
      setIsOpening(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || isOpening}
      className="mx-auto flex h-10 w-full max-w-[400px] items-center justify-center gap-2 rounded-full bg-black text-[15px] font-black text-white transition hover:bg-[#1a1a1a] disabled:cursor-wait disabled:bg-[#4a4a4a]"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 14 17"
        className="h-[17px] w-[14px] fill-current"
      >
        <path d="M11.68 8.98c-.02-1.9 1.55-2.81 1.62-2.85-.88-1.3-2.26-1.47-2.75-1.49-1.17-.12-2.28.69-2.87.69-.59 0-1.5-.67-2.47-.66-1.27.02-2.44.74-3.1 1.88-1.32 2.29-.34 5.68.95 7.54.63.91 1.38 1.93 2.37 1.9.95-.04 1.31-.62 2.46-.62 1.15 0 1.47.62 2.47.6 1.02-.02 1.67-.93 2.29-1.85.72-1.06 1.02-2.09 1.04-2.14-.02-.01-2-.77-2.02-3.05zM9.79 3.4c.52-.64.88-1.52.78-2.4-.75.03-1.67.5-2.21 1.13-.48.56-.91 1.46-.79 2.32.84.06 1.69-.42 2.22-1.05z" />
      </svg>
      Apple로 계속하기
    </button>
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
  const [hasGoogleLoadFailed, setHasGoogleLoadFailed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inAppBrowser: InAppBrowser | null = useSyncExternalStore(
    subscribeNever,
    getInAppBrowserSnapshot,
    getServerInAppBrowserSnapshot,
  );
  const googleNotices = googleLoginNotices(
    inAppBrowser,
    hasGoogleLoadFailed,
  );

  // 전용 탈출 수단이 있는 브라우저는 안내 없이 기본 브라우저로 이동시킨다.
  // generic도 안드로이드면 intent 스킴으로 나간다.
  // iOS generic은 탈출 수단이 없어 이동 없이 남는다. 거기서는 GIS가 정상
  // 로드되므로 로그인 자체는 된다.
  useEffect(() => {
    if (!inAppBrowser) return;
    const escapeUrl = externalBrowserUrl(
      inAppBrowser,
      window.location.href,
      navigator.userAgent,
    );
    if (escapeUrl) window.location.href = escapeUrl;
  }, [inAppBrowser]);

  // 첫 로그인이면 들여보내기 전에 호칭을 한 번 묻는다.
  // (위 탈출은 로그인 전에 끝나므로 이 팝업과 순서가 겹치지 않는다)
  // 약관 동의가 남은 신규 계정은 /terms를 거치므로 그쪽에도 같은 관문이 있다.
  const { pendingDestination, enterApp, resolveName } = useDisplayNameGate();

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
      // 여기서 계측 동의를 표시하지 않는다. 대기 중인 동의가 비어 있다는 것만으로는
      // 어느 버전에 동의했는지 알 수 없고, 서버에 문서가 발행되지 않았을 때도 비어 있다.
      // 표시는 동의 화면(terms-gate)에서 실제로 문서를 제출할 때만 한다.
      await enterApp(nextPath);
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
      {pendingDestination ? (
        <NamePrompt onSubmit={resolveName} onSkip={() => resolveName(null)} />
      ) : null}
      <section className="w-full max-w-md rounded-[32px] bg-white p-7 shadow-[0_24px_80px_rgba(25,31,40,0.1)] sm:p-9">
        <Link href="/" aria-label="Acttub 홈" className="inline-block">
          <Image src={wordmark} alt="Acttub" priority className="h-6 w-auto" />
        </Link>
        <p className="mt-10 text-sm font-black text-[#3182f6]">연기 복기 시작하기</p>
        <h1 className="mt-3 text-3xl font-black leading-tight tracking-[-0.05em]">
          로그인하기
        </h1>
        <p className="mt-4 text-base font-semibold leading-7 text-[#6b7684]">
          영상과 장면 맥락을 안전하게 보관하고, 질문과 연습 노트를 이어서 볼 수 있어요.
        </p>

        <div className="mt-9 space-y-5">
          <GoogleLoginButton
            onCredential={(credential) =>
              void submitLogin(() => loginWith(googleProvider, { credential }))
            }
            onLoadError={() => setHasGoogleLoadFailed(true)}
          />

          {/* Services ID가 설정되기 전에는 눌러도 실패만 하므로 버튼 자체를 내린다. */}
          {APPLE_CLIENT_ID ? (
            <AppleLoginButton
              disabled={isSubmitting}
              onIdToken={(credential) =>
                void submitLogin(() => loginWith(appleProvider, { credential }))
              }
              onError={setErrorMessage}
            />
          ) : null}

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
          {errorMessage || googleNotices.loadError || noticeMessage ? (
            <p
              role="alert"
              className="rounded-2xl bg-[#fff0f0] px-4 py-3 text-sm font-bold text-[#e42939]"
            >
              {errorMessage ?? googleNotices.loadError ?? noticeMessage}
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
