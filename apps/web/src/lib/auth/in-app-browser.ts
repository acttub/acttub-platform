// 인앱 브라우저 감지·탈출.
// 2026-08-10 실측에서 GIS 스크립트는 Android WebView("; wv)")에서만 403이었고,
// iPhone Instagram 인앱 브라우저에서는 정상 로드됐다. 따라서 generic UA만으로
// Google 로그인 차단을 단정하지 않고 실제 GIS 로드 실패와 함께 판단한다
// (안내 문구 쪽 판단은 googleLoginNotices).
//
// 탈출 가능 여부는 그와 별개다 — 안드로이드는 intent 스킴으로 기본 브라우저를
// 부를 수 있고, iOS는 WKWebView가 커스텀 스킴을 호스트 앱에 넘기지 않아 방법이 없다.
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
  // generic은 UA가 아니라 GIS 로드 실패로만 뜨는데, 그 실패가 Android WebView
  // 차단인지 일시적인 네트워크 문제인지 화면에서 구분할 수 없다. 둘 다 답이 되게 쓴다.
  return "Google 로그인을 불러오지 못했어요. 새로고침해도 안 되면 Chrome이나 Safari 같은 기본 브라우저에서 열어 주세요";
}

const GOOGLE_LOAD_ERROR_NOTICE =
  "Google 로그인을 불러오지 못했어요. 새로고침 후 다시 시도해 주세요";

export function googleLoginNotices(
  browser: InAppBrowser | null,
  hasLoadFailed: boolean,
): { inAppBrowser: string | null; loadError: string | null } {
  const shouldShowInAppBrowserNotice =
    browser !== null && (browser !== "generic" || hasLoadFailed);

  return {
    inAppBrowser: shouldShowInAppBrowserNotice
      ? inAppBrowserNotice(browser)
      : null,
    // generic은 같은 실패를 더 구체적인 인앱 안내로 설명한다.
    loadError:
      hasLoadFailed && browser !== "generic" ? GOOGLE_LOAD_ERROR_NOTICE : null,
  };
}
