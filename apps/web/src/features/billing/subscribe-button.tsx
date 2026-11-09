"use client";

import { useState } from "react";

import { startBillingCheckout } from "@/lib/api/v2/billing";
import { PLAN_OPTIONS, type Plan, safeCheckoutUrl, startMessage, startOutcomeOf } from "./billing-flow";

/**
 * 「Pro 구독하기」 (SOMA-818). 서버에서 일회용 카드 등록 창 주소를 받아 그 주소로 이동한다 — 카드는 토스 화면에서만 입력하고
 * 우리 페이지는 카드 정보를 받지 않는다. NEXT_PUBLIC_BILLING_WEB_ENABLED 빌드에서만 /pricing 이 이 버튼을 쓴다.
 * plan 을 주지 않으면 지금처럼 요금제 없이(서버가 월 구독으로) 연다.
 */
export function SubscribeButton({ className, children, plan }: { className: string; children: React.ReactNode; plan?: Plan }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function start() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const checkout = await startBillingCheckout(plan ? { plan } : {});
      const url = safeCheckoutUrl(checkout.checkout_url);
      if (!url) {
        setMessage(startMessage({ kind: "error" }));
        return;
      }
      window.location.assign(url);
    } catch (error) {
      const outcome = startOutcomeOf(error);
      if (outcome.kind === "login_required") {
        window.location.assign("/login?next=/pricing");
        return;
      }
      setMessage(startMessage(outcome));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => void start()} disabled={busy} className={className}>
        {children}
      </button>
      {message ? (
        <p role="alert" className="mt-3 text-sm font-bold leading-6 text-[#f04452]">
          {message}
        </p>
      ) : null}
    </>
  );
}

/**
 * 월/연 선택과 구독 버튼(SOMA-1068). WEB_YEARLY_ENABLED 빌드의 /pricing Pro 카드에서만 쓴다. 기본은 월이고, 고른 요금제로 결제 창을 연다.
 * 새 창·시트 없이 카드 안의 두 칸 라디오다.
 */
export function PlanSubscribe({ className, children }: { className: string; children: React.ReactNode }) {
  const [plan, setPlan] = useState<Plan>("monthly");
  return (
    <>
      <fieldset className="mt-5">
        <legend className="text-[13.5px] font-bold text-[#4e5968]">요금제 선택</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {PLAN_OPTIONS.map((option) => {
            const selected = option.plan === plan;
            return (
              <label
                key={option.plan}
                className={`flex cursor-pointer flex-col rounded-[14px] border-2 bg-white px-4 py-3 transition focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#4880ee] ${
                  selected ? "border-[#4880ee]" : "border-[#e5e8eb] hover:border-[#c9d6f5]"
                }`}
              >
                <input
                  type="radio"
                  name="pro-plan"
                  value={option.plan}
                  checked={selected}
                  onChange={() => setPlan(option.plan)}
                  className="sr-only"
                />
                <span className={`text-[13.5px] font-bold ${selected ? "text-[#3268d8]" : "text-[#6b7684]"}`}>
                  {option.label} 구독
                </span>
                <span className="mt-0.5 text-[17px] font-extrabold tracking-[-0.02em] text-[#191f28]">
                  {option.label} {option.amount.toLocaleString("ko-KR")}원
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <SubscribeButton className={className} plan={plan}>
        {children}
      </SubscribeButton>
    </>
  );
}
