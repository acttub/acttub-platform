"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import {
  createPgReviewCheckout,
  getPgReviewConfig,
  loginPgReview,
  logoutPgReview,
  PG_REVIEW_AMOUNT,
  type PgReviewConfig,
} from "@/lib/api/v2/pg-review";
import { ApiError, errorMessage } from "@/lib/api/v2/errors";
import {
  CHECKOUT_PROBLEM_MESSAGE,
  checkoutProblem,
  isUserCancel,
} from "./pg-review-flow";
import { loadTossSdk } from "./toss-sdk";

// PG(결제대행사) 심사 전용 테스트 결제 화면(SOMA-620). 실제 구독권한·자동갱신·실결제는 없다.
// 폼·입력·버튼 문구가 분석 도구(autocapture·화면 녹화)에 실리지 않도록 ph-no-capture 를 단다.

type Stage =
  | { name: "loading" }
  | { name: "unavailable" }
  | { name: "failed"; message: string }
  | { name: "login" }
  | { name: "checkout" };

type SdkState = "loading" | "ready" | "failed";

const CARD = "rounded-3xl border border-[#e5e8eb] bg-white p-6 sm:p-8";
const PRIMARY_BUTTON =
  "inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-[#3182f6] px-5 text-base font-bold text-white transition-colors hover:bg-[#1b64da] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3182f6] disabled:cursor-not-allowed disabled:bg-[#b0b8c1]";
const INPUT =
  "mt-2 min-h-12 w-full rounded-2xl border border-[#d1d6db] bg-white px-4 text-base text-[#191f28] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3182f6]";

export function PgReviewApp() {
  const [stage, setStage] = useState<Stage>({ name: "loading" });
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getPgReviewConfig(controller.signal)
      .then((config: PgReviewConfig) => {
        if (controller.signal.aborted) return;
        if (!config.available) setStage({ name: "unavailable" });
        else setStage(config.authenticated ? { name: "checkout" } : { name: "login" });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setStage({
          name: "failed",
          message: errorMessage(cause, "화면을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요."),
        });
      });
    return () => controller.abort();
  }, [reloadCount]);

  return (
    <main className="ph-no-capture mx-auto min-h-dvh w-full max-w-3xl px-6 py-12 sm:py-16" data-ph-no-capture>
      <p className="text-sm font-semibold text-[#3182f6]">ACTTUB 결제 심사용 화면</p>
      <h1 className="mt-3 text-3xl font-bold tracking-[-0.03em] text-[#191f28]">ACTTUB Pro 테스트 결제</h1>
      <TestNotice />
      {stage.name === "loading" && (
        <p role="status" className="mt-8 text-base text-[#6b7684]">불러오는 중이에요.</p>
      )}
      {stage.name === "unavailable" && (
        <section className={`${CARD} mt-8`}>
          <h2 className="text-xl font-bold text-[#191f28]">지금은 열려 있지 않아요</h2>
          <p className="mt-3 text-base leading-7 text-[#4e5968]">이 화면은 결제 심사 기간에만 열어요.</p>
        </section>
      )}
      {stage.name === "failed" && (
        <section className={`${CARD} mt-8`} role="alert">
          <p className="text-base leading-7 text-[#4e5968]">{stage.message}</p>
          <button type="button" className={`${PRIMARY_BUTTON} mt-5`} onClick={() => { setStage({ name: "loading" }); setReloadCount((n) => n + 1); }}>
            다시 불러오기
          </button>
        </section>
      )}
      {stage.name === "login" && <LoginForm onDone={() => setStage({ name: "checkout" })} />}
      {stage.name === "checkout" && (
        <CheckoutPanel onLoggedOut={() => setStage({ name: "login" })} />
      )}
    </main>
  );
}

function TestNotice() {
  return (
    <section aria-labelledby="test-notice" className="mt-6 rounded-2xl bg-[#fff4e5] p-5 text-sm leading-7 text-[#7a4b00]">
      <h2 id="test-notice" className="font-bold">결제 심사용 테스트 화면이에요</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>토스페이먼츠 테스트 환경에서만 동작하고, 실제 돈이 빠져나가지 않아요.</li>
        <li>승인되어도 ACTTUB Pro 이용 권한은 주어지지 않아요. 구독 갱신과 자동결제도 없어요.</li>
        <li>여기서 쓰는 심사용 로그인은 ACTTUB 앱 계정과 별개예요.</li>
      </ul>
    </section>
  );
}

function LoginForm({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (busy.current) return;
      busy.current = true;
      setSubmitting(true);
      setError(null);
      try {
        await loginPgReview(username.trim(), password);
        setPassword("");
        onDone();
      } catch (cause) {
        setPassword("");
        setError(
          cause instanceof ApiError && cause.status === 401
            ? "아이디나 비밀번호가 맞지 않아요."
            : cause instanceof ApiError && cause.status === 429
              ? "시도가 너무 많아요. 잠시 뒤 다시 시도해 주세요."
              : errorMessage(cause, "로그인하지 못했어요. 잠시 뒤 다시 시도해 주세요."),
        );
      } finally {
        busy.current = false;
        setSubmitting(false);
      }
    },
    [username, password, onDone],
  );

  return (
    <section aria-labelledby="login-title" className={`${CARD} mt-8`}>
      <h2 id="login-title" className="text-xl font-bold text-[#191f28]">심사용 로그인</h2>
      <form onSubmit={submit} className="mt-4" noValidate>
        <label htmlFor="pg-review-username" className="block text-sm font-semibold text-[#4e5968]">아이디</label>
        <input
          id="pg-review-username"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          className={INPUT}
        />
        <label htmlFor="pg-review-password" className="mt-4 block text-sm font-semibold text-[#4e5968]">비밀번호</label>
        <input
          id="pg-review-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={INPUT}
        />
        {error && <p role="alert" className="mt-3 text-sm text-[#e5484d]">{error}</p>}
        <button type="submit" disabled={submitting || !username.trim() || !password} className={`${PRIMARY_BUTTON} mt-5`}>
          {submitting ? "확인하는 중이에요" : "로그인"}
        </button>
      </form>
    </section>
  );
}

function CheckoutPanel({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [agreeTest, setAgreeTest] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreeCard, setAgreeCard] = useState(false);
  const [sdk, setSdk] = useState<SdkState>("loading");
  const [sdkAttempt, setSdkAttempt] = useState(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let current = true;
    loadTossSdk()
      .then(() => current && setSdk("ready"))
      .catch(() => current && setSdk("failed"));
    return () => {
      current = false;
    };
  }, [sdkAttempt]);

  // 토스 화면에서 뒤로 가기로 돌아오면 이 화면이 그대로 복원돼 "이동 중"에 갇힌다.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      busy.current = false;
      setStarting(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  const allAgreed = agreeTest && agreeTerms && agreeCard;

  const start = useCallback(async () => {
    if (busy.current || !allAgreed) return;
    busy.current = true;
    setStarting(true);
    setError(null);
    try {
      const factory = await loadTossSdk();
      // 주문과 일회용 state 는 누를 때마다 서버가 새로 발급한다.
      const checkout = await createPgReviewCheckout();
      if (checkoutProblem(checkout, window.location.origin) !== null) {
        throw new Error(CHECKOUT_PROBLEM_MESSAGE);
      }
      const payment = factory(checkout.clientKey).payment({ customerKey: checkout.customerKey });
      await payment.requestBillingAuth({
        method: "CARD",
        successUrl: checkout.successUrl,
        failUrl: checkout.failUrl,
      });
      // 성공하면 브라우저가 토스 화면으로 이동한다. 이동 전까지는 버튼을 잠근 채 둔다.
    } catch (cause) {
      busy.current = false;
      setStarting(false);
      if (isUserCancel(cause)) return;
      if (cause instanceof ApiError && cause.status === 401) {
        onLoggedOut();
        return;
      }
      setError(
        cause instanceof Error && cause.message === CHECKOUT_PROBLEM_MESSAGE
          ? CHECKOUT_PROBLEM_MESSAGE
          : errorMessage(cause, "결제창을 열지 못했어요. 잠시 뒤 다시 시도해 주세요."),
      );
    }
  }, [allAgreed, onLoggedOut]);

  const logout = useCallback(async () => {
    try {
      await logoutPgReview();
    } finally {
      onLoggedOut();
    }
  }, [onLoggedOut]);

  return (
    <>
      <section aria-labelledby="product-title" className={`${CARD} mt-8`}>
        <p className="text-sm font-semibold text-[#3182f6]">테스트 상품</p>
        <h2 id="product-title" className="mt-2 text-2xl font-bold text-[#191f28]">ACTTUB Pro 월 구독</h2>
        <p className="mt-4 text-4xl font-bold tracking-tight text-[#191f28]">월 {PG_REVIEW_AMOUNT.toLocaleString("ko-KR")}원</p>
        <p className="mt-2 text-sm text-[#6b7684]">부가세 포함 · 결제일부터 1개월 · 매월 정기결제 방식</p>
        <dl className="mt-6 space-y-3 text-sm leading-6 text-[#4e5968]">
          <div>
            <dt className="font-bold text-[#191f28]">서비스 일정</dt>
            <dd>10월 26일 사전 안내, 11월 2일 구독 시작 예정이에요. 지금은 실제 결제와 이용 권한이 없어요.</dd>
          </div>
          <div>
            <dt className="font-bold text-[#191f28]">이번 테스트에서 일어나는 일</dt>
            <dd>토스페이먼츠 화면에서 테스트 카드를 등록하면, 서버가 첫 테스트 승인 {PG_REVIEW_AMOUNT.toLocaleString("ko-KR")}원을 한 번 요청해요.</dd>
          </div>
          <div>
            <dt className="font-bold text-[#191f28]">환불·해지</dt>
            <dd>
              <Link href="/refund" target="_blank" rel="noopener" className="font-semibold text-[#3182f6] underline underline-offset-4">환불 기준 보기</Link>
              <span> · </span>
              <Link href="/pricing" target="_blank" rel="noopener" className="font-semibold text-[#3182f6] underline underline-offset-4">요금 안내 보기</Link>
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="agree-title" className={`${CARD} mt-6`}>
        <h2 id="agree-title" className="text-xl font-bold text-[#191f28]">필수 확인</h2>
        <div className="mt-4 space-y-3">
          <Agreement id="pg-agree-test" checked={agreeTest} onChange={setAgreeTest}>
            심사용 테스트 결제이며 실제 구독 권한과 자동 갱신이 없다는 것을 확인했어요.
          </Agreement>
          <Agreement id="pg-agree-terms" checked={agreeTerms} onChange={setAgreeTerms}>
            월 {PG_REVIEW_AMOUNT.toLocaleString("ko-KR")}원(부가세 포함) 상품 내용과 환불 기준을 확인했어요.
          </Agreement>
          <Agreement id="pg-agree-card" checked={agreeCard} onChange={setAgreeCard}>
            카드 정보는 토스페이먼츠 화면에서만 입력하고 ACTTUB은 받지 않는다는 것을 확인했어요.
          </Agreement>
        </div>
        {sdk === "failed" && (
          <p role="alert" className="mt-4 text-sm text-[#e5484d]">
            결제창 구성요소를 불러오지 못했어요. 연결을 확인한 뒤 다시 불러와 주세요.{" "}
            <button type="button" className="font-semibold underline underline-offset-4" onClick={() => { setSdk("loading"); setSdkAttempt((n) => n + 1); }}>
              다시 불러오기
            </button>
          </p>
        )}
        {error && <p role="alert" className="mt-4 text-sm text-[#e5484d]">{error}</p>}
        <button
          type="button"
          onClick={start}
          disabled={!allAgreed || starting || sdk !== "ready"}
          aria-busy={starting}
          className={`${PRIMARY_BUTTON} mt-5`}
        >
          {starting ? "결제창으로 이동하는 중이에요" : sdk === "loading" ? "결제창 준비 중이에요" : "카드 등록하고 테스트 결제하기"}
        </button>
        <button type="button" onClick={logout} className="mt-3 w-full min-h-11 text-sm font-semibold text-[#6b7684] underline underline-offset-4">
          심사용 로그아웃
        </button>
      </section>
    </>
  );
}

function Agreement({
  id,
  checked,
  onChange,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-2xl bg-[#f9fafb] p-4 text-sm leading-6 text-[#4e5968]">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-5 w-5 shrink-0 accent-[#3182f6]"
      />
      <span>{children}</span>
    </label>
  );
}
