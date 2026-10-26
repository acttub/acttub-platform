"use client";

import { useState } from "react";

import { startBillingCheckout } from "@/lib/api/v2/billing";
import { safeCheckoutUrl, startMessage, startOutcomeOf } from "./billing-flow";

/**
 * 「Pro 구독하기」 (SOMA-818). 서버에서 일회용 카드 등록 창 주소를 받아 그 주소로 이동한다 — 카드는 토스 화면에서만 입력하고
 * 우리 페이지는 카드 정보를 받지 않는다. NEXT_PUBLIC_BILLING_WEB_ENABLED 빌드에서만 /pricing 이 이 버튼을 쓴다.
 */
export function SubscribeButton({ className, children }: { className: string; children: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function start() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const checkout = await startBillingCheckout();
      const url = safeCheckoutUrl(checkout.checkout_url);
      if (!url) {
        setMessage(startMessage({ kind: "error" }));
        return;
      }
      window.location.assign(url);
    } catch (error) {
      setMessage(startMessage(startOutcomeOf(error)));
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
