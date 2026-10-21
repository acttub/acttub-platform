import type { MarketingNotice } from './marketing-consent.ts';

type Listener = (notice: MarketingNotice) => void;

const listeners = new Set<Listener>();

/**
 * 광고성 정보 처리 결과 팝업(S5.13)을 앱 전체 자리(MarketingNoticeHost)에 띄운다. 가입 동의·재동의 팝업은 저장이
 * 끝나면 바로 내려가므로 자기 화면 안에 띄울 수 없다 — 다음 화면 위에 뜨도록 이리로 보낸다.
 */
export function showMarketingNotice(notice: MarketingNotice): void {
  for (const listener of listeners) listener(notice);
}

export function subscribeMarketingNotice(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
