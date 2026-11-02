"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { PAYMENT_START_NOTICE } from "@/features/help/help-content";
import { cancelBillingSubscription, fetchBillingMe, type BillingMe } from "@/lib/api/v2/billing";
import { cancelDoneMessage, subscriptionViewOf } from "./billing-flow";

type State = { kind: "loading" } | { kind: "closed" } | { kind: "error" } | { kind: "ready"; me: BillingMe };

/**
 * 내 계정의 「구독」 칸 (SOMA-818, SOMA-834). 이 화면에서 상자로 묶는 곳은 여기 하나뿐이다.
 * 웹(토스) 구독은 상태를 보고 여기서 해지한다. 앱 스토어 구독은 그 스토어에서 바꾸고 해지하는 길만 안내한다.
 * 서버가 결제를 닫아 두면(404) 결제 시작 안내만 보인다. 웹 결제를 연 빌드가 아니어도 스토어 구독은 읽는다.
 */
export function SubscriptionCard() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
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

  const frame = (children: React.ReactNode, busy = false) => (
    <section aria-labelledby="account-subscription" aria-busy={busy}>
      <h2 id="account-subscription" className="text-xl font-black">구독</h2>
      <div className="mt-5 rounded-[28px] bg-[#f2f4f6] p-6 sm:p-8">{children}</div>
    </section>
  );

  if (state.kind === "loading") {
    return frame(
      <>
        <div className="h-6 w-24 animate-pulse rounded bg-[#e5e8eb]" />
        <div className="mt-4 h-4 w-56 animate-pulse rounded bg-[#e5e8eb]" />
      </>,
      true,
    );
  }

  if (state.kind === "closed" || state.kind === "error") {
    return frame(
      <>
        <p className="text-base leading-7 text-[#4e5968]">
          {state.kind === "error" ? "구독 정보를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요." : PAYMENT_START_NOTICE}
        </p>
        <Link href="/pricing" className="mt-3 inline-block text-sm font-semibold text-[#3182f6]">요금 안내 보기</Link>
      </>,
    );
  }

  const view = subscriptionViewOf(state.me);
  return frame(
    <>
      <p className="flex flex-wrap items-center gap-2.5">
        <span className="text-xl font-black text-[#191f28]">{view.title}</span>
        {view.badge ? <span className="rounded-lg bg-white px-2.5 py-1 text-[13px] font-bold text-[#4e5968]">{view.badge}</span> : null}
      </p>
      {view.summary ? <p className="mt-3 text-base leading-7 text-[#191f28]">{view.summary}</p> : null}
      <ul className="mt-3 space-y-1 text-[15px] leading-7 text-[#4e5968]">
        {view.lines.map((line) => <li key={line}>{line}</li>)}
      </ul>
      {notice ? <p role="status" className="mt-4 rounded-2xl bg-[#e8f3ff] p-4 text-sm leading-6 text-[#1b64da]">{notice}</p> : null}
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
    </>,
  );
}
