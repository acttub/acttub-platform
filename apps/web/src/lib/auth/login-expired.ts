// 회원 로그인이 풀린 것을 이 탭에 남긴다(SOMA-834). 회원의 갱신이 거절되면 새 게스트를 만들지 않고
// 이 표시를 세운다 — 화면은 "로그인이 풀렸어요" 안내를 띄운다. 다시 로그인하거나 닫으면 지운다.
const KEY = "acttub.web.login_expired";
export const LOGIN_EXPIRED_EVENT = "acttub:login-expired";

const store = (): Storage | null => (typeof window === "undefined" ? null : window.sessionStorage);

function announce(): void {
  if (typeof window === "undefined") return;
  // jsdom 같은 환경에서는 그 창의 Event 로 만들어야 받는다.
  const EventCtor = (window as unknown as { Event?: typeof Event }).Event ?? (typeof Event === "undefined" ? undefined : Event);
  if (!EventCtor || typeof window.dispatchEvent !== "function") return;
  try {
    window.dispatchEvent(new EventCtor(LOGIN_EXPIRED_EVENT));
  } catch {
    // 알림은 화면 갱신용이다. 못 보내도 토큰 저장은 이미 끝났다.
  }
}

export function markLoginExpired(): void {
  store()?.setItem(KEY, "1");
  announce();
}

export function clearLoginExpired(): void {
  store()?.removeItem(KEY);
  announce();
}

export function isLoginExpired(): boolean {
  return store()?.getItem(KEY) === "1";
}

export function subscribeLoginExpired(onChange: () => void): () => void {
  window.addEventListener(LOGIN_EXPIRED_EVENT, onChange);
  return () => window.removeEventListener(LOGIN_EXPIRED_EVENT, onChange);
}
