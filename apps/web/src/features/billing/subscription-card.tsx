"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { PAYMENT_START_NOTICE } from "@/features/help/help-content";
import { cancelBillingSubscription, fetchBillingMe, type BillingMe } from "@/lib/api/v2/billing";
import { WEB_BILLING_ENABLED, cancelDoneMessage, subscriptionViewOf } from "./billing-flow";

const card = "rounded-[28px] bg-white p-6 ring-1 ring-[#e5e8eb] sm:p-8";

type State = { kind: "loading" } | { kind: "closed" } | { kind: "error" } | { kind: "ready"; me: BillingMe };

/**
 * 내 계정의 「구독」 칸 (SOMA-818). 웹(토스) 구독은 여기서 상태를 보고 해지한다. 앱 스토어 구독은 해지할 곳만 안내한다.
 * 웹 결제를 열지 않은 빌드이거나 서버가 결제를 닫아 두면(404) 예전처럼 결제 시작 안내만 보인다.
 */
export function SubscriptionCard() {
  const [state, setState] = useState<State>(WEB_BILLING_ENABLED ? { kind: "loading" } : { kind: "closed" });
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!WEB_BILLING_ENABLED) return;
    const controller = new AbortController();
    fetchBillingMe({ signal: controller.signal })
      .then((me) => setState({ kind: "ready", me }))
      .catch((error: { status?: number; name?: string }) => {
        if (error?.name === "AbortError") return;
        setState(error?.status === 404 ? { kind: "closed" } : { kind: "error" });
      });
    return () => controller.abort();
  }, []);

  async function cancel() {
    if (pending) return;
    setPending(true);
    setNotice(null);
    try {
      const me = await cancelBillingSubscription();
      setState({ kind: "ready", me });
      setConfirming(false);
      setNotice(cancelDoneMessage(me));
    } catch {
      setNotice("해지하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  if (state.kind === "loading") {
    return (
      <section className={card} aria-busy="true">
        <h2 className="text-xl font-black">구독</h2>
        <div className="mt-4 h-4 w-40 animate-pulse rounded bg-[#f2f4f6]" />
        <div className="mt-3 h-4 w-56 animate-pulse rounded bg-[#f2f4f6]" />
      </section>
    );
  }

  if (state.kind === "closed" || state.kind === "error") {
    return (
      <section className={card}>
        <h2 className="text-xl font-black">구독</h2>
        <p className="mt-2 text-sm leading-6 text-[#4e5968]">
          {state.kind === "error" ? "구독 정보를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요." : PAYMENT_START_NOTICE}
        </p>
        <Link href="/pricing" className="mt-3 inline-block text-sm font-semibold text-[#3182f6]">요금 안내 보기</Link>
      </section>
    );
  }

  const view = subscriptionViewOf(state.me);
  return (
    <section className={card}>
      <h2 className="text-xl font-black">구독</h2>
      <p className="mt-3 text-base font-bold">{view.title}</p>
      <ul className="mt-2 space-y-1 text-sm leading-6 text-[#4e5968]">
        {view.lines.map((line) => <li key={line}>{line}</li>)}
      </ul>
      {notice ? <p role="status" className="mt-3 rounded-2xl bg-[#e8f3ff] p-4 text-sm leading-6 text-[#1b64da]">{notice}</p> : null}
      {view.showPricing ? (
        <Link href="/pricing" className="mt-4 inline-block text-sm font-semibold text-[#3182f6]">요금 안내·Pro 구독하기</Link>
      ) : null}
      {view.cancelable ? (
        !confirming ? (
          <button type="button" onClick={() => setConfirming(true)} className="mt-4 block text-sm font-semibold text-[#4e5968] underline underline-offset-2">
            구독 해지하기
          </button>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-sm leading-6 text-[#4e5968]">
              해지하면 다음 자동결제가 되지 않아요. 이미 결제한 기간이 끝날 때까지는 Pro를 그대로 써요. 환불은{" "}
              <Link href="/refund" className="font-semibold text-[#3182f6]">해지·환불 정책</Link>을 따라요.
            </p>
            <div className="flex gap-2">
              <button type="button" disabled={pending} onClick={() => void cancel()} className="rounded-2xl bg-[#191f28] px-4 py-2.5 text-sm font-bold text-white">
                {pending ? "해지하는 중이에요" : "해지"}
              </button>
              <button type="button" disabled={pending} onClick={() => setConfirming(false)} className="rounded-2xl px-4 py-2.5 text-sm font-bold text-[#4e5968] ring-1 ring-[#e5e8eb]">
                그만두기
              </button>
            </div>
          </div>
        )
      ) : null}
    </section>
  );
}
