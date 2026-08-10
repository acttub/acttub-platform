// 인앱 브라우저(WebView) 감지·탈출.
// Google은 WebView에서의 OAuth 로그인을 차단하므로(disallowed_useragent),
// 페이지 도착 직후 또는 로그인 화면에서 기본 브라우저로 이동시키거나 안내 문구를 보여준다.
// 모듈 최상위에서 window에 접근하지 않는다 (정적 프리렌더 제약).

export type InAppBrowser = "kakaotalk" | "line" | "generic";

const LINE_ESCAPE_PARAM = "openExternalBrowser";

export function detectInAppBrowser(userAgent: string): InAppBrowser | null {
  if (/KAKAOTALK/i.test(userAgent)) return "kakaotalk";
  if (/\bLine\//i.test(userAgent)) return "line";
  // 전용 탈출 수단이 없는 인앱 브라우저들 + Android WebView 공통 마커("; wv)").
  if (
    /Instagram|FBAN|FBAV|FB_IAB|NAVER\(inapp|DaumApps|; wv\)/i.test(userAgent)
  ) {
    return "generic";
  }
  return null;
}

// 기본 브라우저로 탈출시키는 이동 URL. 탈출 수단이 없는 브라우저면 null.
export function externalBrowserUrl(
  browser: InAppBrowser,
  currentUrl: string,
  userAgent: string,
): string | null {
  if (browser === "kakaotalk") {
    return `kakaotalk://web/openExternal?url=${encodeURIComponent(currentUrl)}`;
  }
  if (browser === "line") {
    const url = new URL(currentUrl);
    // 파라미터가 이미 붙어 있다면 탈출이 동작하지 않은 상태 — 재이동 루프를 막는다.
    if (url.searchParams.get(LINE_ESCAPE_PARAM) === "1") return null;
    url.searchParams.set(LINE_ESCAPE_PARAM, "1");
    return url.toString();
  }

  // Android는 intent 스킴으로 기본 브라우저를 부를 수 있다.
  // package를 못박지 않는다 — 크롬이 없는 기기(삼성 인터넷만 쓰는 갤럭시)에서 실패하고,
  // 그때 쓰는 S.browser_fallback_url은 intent를 해석한 쪽이 처리하는 관례라
  // 인스타 웹뷰가 구현하지 않았으면 에러 화면으로 끝난다.
  if (/Android/i.test(userAgent)) {
    return (
      "intent://" +
      currentUrl.split("#")[0].replace(/^https?:\/\//, "") +
      "#Intent;scheme=https;end"
    );
  }

  // iOS: WKWebView가 커스텀 스킴을 호스트 앱에 넘기지 않는다. 안내 문구가 최선이다.
  return null;
}

export function inAppBrowserNotice(browser: InAppBrowser): string {
  if (browser === "kakaotalk") {
    return "카카오톡 브라우저에서는 Google 로그인이 막혀 있어 기본 브라우저로 이동해요. 이동하지 않으면 오른쪽 아래 메뉴에서 '다른 브라우저로 열기'를 눌러 주세요";
  }
  if (browser === "line") {
    return "LINE 브라우저에서는 Google 로그인이 막혀 있어 기본 브라우저로 이동해요. 이동하지 않으면 메뉴에서 '기본 브라우저로 열기'를 눌러 주세요";
  }
  return "앱 안 브라우저에서는 Google 로그인이 막혀 있어요. Chrome이나 Safari 같은 기본 브라우저에서 다시 열어 주세요";
}
