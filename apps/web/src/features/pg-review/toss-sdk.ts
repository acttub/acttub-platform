import { TOSS_SDK_URL } from "./pg-review-flow";

// 토스페이먼츠 결제 SDK v2(공식 https://docs.tosspayments.com/sdk/v2/js/payment). 카드 정보는
// 토스 화면에서만 입력되고 ACTTUB 화면은 받지 않는다.

export type TossBillingAuthRequest = {
  method: "CARD";
  successUrl: string;
  failUrl: string;
};

export type TossPaymentInstance = {
  requestBillingAuth: (request: TossBillingAuthRequest) => Promise<void>;
};

export type TossPaymentsFactory = (clientKey: string) => {
  payment: (options: { customerKey: string }) => TossPaymentInstance;
};

declare global {
  interface Window {
    TossPayments?: TossPaymentsFactory;
  }
}

const LOAD_TIMEOUT_MS = 15_000;

let loading: Promise<TossPaymentsFactory> | null = null;

/** SDK 스크립트를 한 번만 불러온다. 실패하면 다음 호출이 다시 시도한다. */
export function loadTossSdk(): Promise<TossPaymentsFactory> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.TossPayments) return Promise.resolve(window.TossPayments);
  if (loading) return loading;

  loading = new Promise<TossPaymentsFactory>((resolve, reject) => {
    const script = document.createElement("script");
    const fail = (reason: string) => {
      window.clearTimeout(timer);
      script.remove();
      loading = null;
      reject(new Error(reason));
    };
    const timer = window.setTimeout(() => fail("sdk_timeout"), LOAD_TIMEOUT_MS);
    script.src = TOSS_SDK_URL;
    script.async = true;
    script.onload = () => {
      if (window.TossPayments) {
        window.clearTimeout(timer);
        resolve(window.TossPayments);
      } else {
        fail("sdk_missing");
      }
    };
    script.onerror = () => fail("sdk_load_failed");
    document.head.append(script);
  });
  return loading;
}
