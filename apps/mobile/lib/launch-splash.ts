// 앱을 켤 때 로고(스플래시)에서 홈으로 바로 넘어가게 한다.
// 예전에는 로그인·동의·프로필 확인만 끝나면 로고를 닫아, 홈이 첫 데이터를 받는 동안
// 흰 화면에 작은 로딩 표시가 잠깐 보였다. 이제 홈이 첫 데이터를 다 받았다고 알릴 때까지
// 로고를 그대로 두고, 서버가 느려도 로고가 끝없이 남지 않도록 상한을 둔다.

/** 홈을 기다리며 로고를 붙잡아 두는 최대 시간(ms). 이 시간이 지나면 홈이 준비되지 않았어도 닫는다. */
export const HOME_SPLASH_HOLD_MS = 3000;

let homeReady = false;
const listeners = new Set<() => void>();

/** 홈 화면이 첫 데이터를 다 받았을 때 한 번 부른다. */
export function markHomeReady(): void {
  if (homeReady) return;
  homeReady = true;
  listeners.forEach((listener) => listener());
}

export function isHomeReady(): boolean {
  return homeReady;
}

export function subscribeHomeReady(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 로고를 닫아도 되는 조건(readyToShow)이 됐을 때, 홈을 기다리느라 조금 더 붙잡아야 하는지.
 * 로그인을 마치고 홈으로 들어가는 길에서만 기다린다. 로그인·동의·프로필 화면이나
 * 분석 화면처럼 다른 곳으로 가면 기다리지 않는다.
 */
export function shouldHoldSplashForHome(input: {
  signedInHome: boolean;
  pathname: string;
  homeReady: boolean;
  holdExpired: boolean;
}): boolean {
  return input.signedInHome && input.pathname === '/' && !input.homeReady && !input.holdExpired;
}

/** 테스트 전용 — 모듈 상태를 처음으로 되돌린다. */
export function resetHomeReadyForTest(): void {
  homeReady = false;
  listeners.clear();
}
