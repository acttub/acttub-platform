/**
 * 네이버 로그인 콜백을 앱으로 넘기는 주소(account.login, 결정 I-5).
 *
 * 네이버는 Callback URL 로 http(s)만 받는다. 앱은 이 웹의 `/auth/naver/callback`(API 와 같은 호스트)을
 * redirect_uri 로 쓰고, 이 페이지는 받은 값을 손대지 않고 앱 스킴으로 넘긴다. 코드 교환·state 대조는
 * 앱과 서버가 한다 — 웹은 값을 읽거나 남기지 않는다. 앱 스킴은 apps/mobile/app.json 의 scheme 이다.
 */
export const NAVER_APP_RETURN_URL = "actingapp://auth/naver";

// 네이버가 콜백에 싣는 값(로그인 API 명세 §4.1). 그 밖의 값은 넘기지 않는다.
const FORWARDED = ["code", "state", "error", "error_description"] as const;

export function naverAppReturnUrl(search: string): string {
  const received = new URLSearchParams(search);
  const forwarded = new URLSearchParams();
  for (const key of FORWARDED) {
    const value = received.get(key);
    if (value !== null) forwarded.set(key, value);
  }
  const query = forwarded.toString();
  return query ? `${NAVER_APP_RETURN_URL}?${query}` : NAVER_APP_RETURN_URL;
}
