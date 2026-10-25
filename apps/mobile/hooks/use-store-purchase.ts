/**
 * 앱 안의 Pro 구매(App Store·Play 스토어 구독) 자리 — 2단계(SOMA-818 후속)가 여기에 붙는다. 지금은 구매 수단이 없어
 * available 이 false 이고, Pro 화면은 구매 버튼을 그리지 않는다. 앱 안에서 웹 결제로 보내는 경로는 두지 않는다(Apple 규정).
 */
export type StorePurchase = {
  /** 이 기기에서 스토어 구매를 시작할 수 있는가. */
  available: boolean;
  busy: boolean;
  error: string | null;
  begin: () => void;
};

export function useStorePurchase(): StorePurchase {
  return { available: false, busy: false, error: null, begin: () => undefined };
}
